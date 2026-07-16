/* ======================= تهيئة اتصال Supabase ======================= */
const SUPABASE_URL = "https://hhknbkyjalsbanoudoos.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SaukFLYePA4O6j9hm33Xfw_uvyYm1u-";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const KEYS = { PRODUCTS: "qissa:products", ORDERS: "qissa:orders", SETTINGS: "qissa:settings" };
const DEFAULT_PW_HASH = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ======================= حالة عامة ======================= */
let state = {
  view: "store",
  adminTab: "products",
  products: [],
  orders: [],
  settings: { whatsapp: "" },
  selectedProduct: null,
  // بيانات المشرف الحالي (owner أو staff) - محفوظة في الذاكرة فقط لهذه الجلسة، لا تُخزَّن على القرص
  currentAdmin: null, // { username, role, passwordHash }
  staffList: [],
};

const app = document.getElementById("app");
const loadingEl = document.getElementById("loading");
const modalBg = document.getElementById("modalBg");

function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function money(n){ return Number(n||0).toLocaleString("ar"); }

function showToast(text, kind="ok"){
  const host = document.getElementById("toastHost");
  const el = document.createElement("div");
  el.className = "toast" + (kind==="err" ? " err" : "");
  el.textContent = text;
  host.appendChild(el);
  setTimeout(()=> el.remove(), 3200);
}

/* ======================= الإعدادات (متزامنة عبر Supabase) ======================= */
async function loadSettings(){
  try {
    const { data, error } = await supabaseClient
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (!error && data) {
      state.settings = { whatsapp: data.whatsapp || "" };
      return;
    }
  } catch (e) { console.error("settings load error", e); }
  // fallback محلي إن تعذر الاتصال بالسحابة
  state.settings = loadLocal(KEYS.SETTINGS, { whatsapp: "" });
}

async function saveWhatsapp(newNumber){
  const { error } = await supabaseClient
    .from('settings')
    .update({ whatsapp: newNumber })
    .eq('id', 1);
  if (error) {
    console.error("settings save error", error);
    saveLocal(KEYS.SETTINGS, { whatsapp: newNumber }); // احتياط محلي فقط
    return false;
  }
  state.settings.whatsapp = newNumber;
  return true;
}

/* ======================= توجيه واتساب ======================= */
function formatWhatsapp(raw){
  let d = (raw||"").replace(/\D/g,"");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "964" + d.slice(1);
  return d;
}
function isValidWhatsapp(raw){
  const d = formatWhatsapp(raw);
  return d.length >= 10 && d.length <= 15;
}

/* ======================= ضغط الصور إلى base64 ======================= */
function resizeImage(file, maxW=720, quality=0.72){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW/img.width);
        const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
        const canvas = document.createElement("canvas");
        canvas.width=w; canvas.height=h;
        canvas.getContext("2d").drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ======================= الرندر الرئيسي ======================= */
function render(){
  if (state.view === "store") return renderStore();
  if (state.view === "adminLogin") return renderAdminLogin();
  if (state.view === "admin") return renderAdmin();
}

function renderStore(){
  const items = state.products.map(p => {
    const imgTag = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : '🧴';
    return `
      <div class="card">
        <div class="img">${imgTag}</div>
        <div class="body">
          <div class="seal">${money(p.price)}<br>د.ع</div>
          <div class="info">
            <h3>${esc(p.name)}</h3>
            ${p.description ? `<p>${esc(p.description)}</p>` : ""}
          </div>
        </div>
        <button class="book-btn" data-book="${p.id}">احجزي الآن</button>
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <div class="wrap">
      <header class="hero">
        <p class="eyebrow">عناية بالجسم</p>
        <h1 class="brand display">قصّة</h1>
        <p class="lede">كل منتج هنا هو فصل من طقوسك اليومية. اختاري منتجك واحجزيه، وسنتواصل معك لإتمام الطلب.</p>
      </header>
      ${state.products.length === 0 ? `<div class="empty">لم تتم إضافة أي منتجات بعد.</div>` : `<div class="grid">${items}</div>`}
    </div>
    <button class="fab" id="adminFab" title="دخول الإدارة">🔒</button>
  `;

  app.querySelectorAll("[data-book]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedProduct = state.products.find(p => p.id === btn.dataset.book);
      openBookingModal();
    });
  });
  document.getElementById("adminFab").addEventListener("click", () => {
    state.view = "adminLogin";
    render();
  });
}

/* ---------- نافذة الحجز ---------- */
function openBookingModal(){
  const p = state.selectedProduct;
  let qty = 1;

  function paint(){
    const total = qty * Number(p.price);
    const modalImg = p.image ? '<img src="' + esc(p.image) + '">' : '<div class="ph"></div>';
    modalBg.innerHTML = `
      <div class="modal">
        <div class="row">
          <h2>تأكيد الحجز</h2>
          <button class="close-x" id="closeModal">✕</button>
        </div>
        <div class="product-preview">
          ${modalImg}
          <div>
            <div style="font-weight:600">${esc(p.name)}</div>
            <div style="font-size:13px;color:var(--muted)">${money(p.price)} د.ع للقطعة</div>
          </div>
        </div>
        <div class="qty-row">
          <span style="font-size:14px;font-weight:600;">الكمية</span>
          <div class="qty-ctl">
            <button id="qtyMinus">−</button>
            <span id="qtyVal" style="min-width:20px;text-align:center;font-weight:700;">${qty}</span>
            <button id="qtyPlus">+</button>
          </div>
        </div>
        <div class="field"><div class="box">👤<input id="fName" placeholder="الاسم الكامل"></div><div class="err" id="errName"></div></div>
        <div class="field"><div class="box">📍<input id="fLoc" placeholder="الموقع / العنوان"></div><div class="err" id="errLoc"></div></div>
        <div class="field"><div class="box">📞<input id="fPhone" placeholder="رقم الهاتف" type="tel"></div><div class="err" id="errPhone"></div></div>
        <div class="total-row"><span style="font-weight:400;color:var(--muted)">الإجمالي</span><span>${money(total)} د.ع</span></div>
        <button class="primary-btn" id="submitOrder">تأكيد الحجز</button>
      </div>
    `;
    document.getElementById("closeModal").onclick = closeModal;
    modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
    document.getElementById("qtyMinus").onclick = () => { qty = Math.max(1, qty-1); paint(); };
    document.getElementById("qtyPlus").onclick = () => { qty = Math.min(10, qty+1); paint(); };
    document.getElementById("submitOrder").onclick = submit;
  }

  async function submit(){
    const name = document.getElementById("fName").value.trim();
    const loc = document.getElementById("fLoc").value.trim();
    const phone = document.getElementById("fPhone").value.trim();
    let ok = true;
    document.getElementById("errName").textContent = "";
    document.getElementById("errLoc").textContent = "";
    document.getElementById("errPhone").textContent = "";
    if (!name){ document.getElementById("errName").textContent = "أدخلي الاسم"; ok = false; }
    if (!loc){ document.getElementById("errLoc").textContent = "أدخلي الموقع"; ok = false; }
    if (!phone || phone.replace(/\D/g,"").length < 8){ document.getElementById("errPhone").textContent = "أدخلي رقم هاتف صحيح"; ok = false; }
    if (!ok) return;

    const btn = document.getElementById("submitOrder");
    btn.disabled = true; btn.textContent = "جارِ الإرسال...";

    const total = qty * Number(p.price);

    // إرسال الطلب إلى جدول orders في Supabase (نفس الحقول الأصلية فقط، لتفادي أخطاء أعمدة غير موجودة)
    const { error } = await supabaseClient
      .from('orders')
      .insert([
        {
          customer_name: name,
          phone_number: phone,
          location: loc,
          product_name: `${p.name} (عدد: ${qty})`
        }
      ]);

    if (error) {
      console.error("Database insert error:", error);
      showToast("تعذر حفظ الحجز: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "تأكيد الحجز";
      return;
    }

    // تحديث فوري للواجهة محليًا (الصورة/الكمية/الإجمالي تُعرض هنا فقط، لأن جدول orders الأصلي لا يخزنها)
    const localOrder = {
      id: uid(),
      product_name: `${p.name} (عدد: ${qty})`,
      product_image: p.image || "",
      total,
      qty,
      customer_name: name,
      location: loc,
      phone_number: phone,
      created_at: new Date().toISOString()
    };
    state.orders.unshift(localOrder);

    const num = formatWhatsapp(state.settings.whatsapp);
    if (num){
      const msg = `حجز جديد من متجر قصة\nالمنتج: ${p.name}\nالكمية: ${qty}\nالسعر الإجمالي: ${total} د.ع\nاسم العميل: ${name}\nالموقع: ${loc}\nرقم الهاتف: ${phone}`;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
    }
    showToast("تم إرسال الحجز بنجاح، سيتم التواصل معك قريبًا");
    closeModal();
    render();
  }

  paint();
  modalBg.classList.add("open");
}

function closeModal(){
  modalBg.classList.remove("open");
  modalBg.innerHTML = "";
}

/* ---------- تسجيل دخول الأدمن (يوزر + رمز، عبر Supabase) ---------- */
function renderAdminLogin(){
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="center" style="margin-bottom:14px;">
          <div class="seal" style="margin:0 auto;">دخول</div>
        </div>
        <h2 class="center" style="margin:0 0 4px;">لوحة الإدارة</h2>
        <p class="hint center">أدخلي اسم المستخدم وكلمة المرور للدخول</p>
        <div class="field"><div class="box">👤<input id="usr" placeholder="اسم المستخدم" autocomplete="username"></div></div>
        <div class="field"><div class="box">🔑<input id="pw" placeholder="كلمة المرور" type="password" autocomplete="current-password"></div></div>
        <div class="err" id="loginErr" style="margin-bottom:10px;color:var(--err);font-size:12px;"></div>
        <button class="primary-btn" id="loginBtn">دخول</button>
        <button class="ghost-btn" id="backBtn">→ العودة للمتجر</button>
      </div>
    </div>
  `;
  document.getElementById("backBtn").onclick = () => { state.view = "store"; render(); };

  const usrInput = document.getElementById("usr");
  const pwInput = document.getElementById("pw");
  pwInput.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  document.getElementById("loginBtn").onclick = doLogin;

  async function doLogin(){
    const username = usrInput.value.trim();
    const pw = pwInput.value;
    const btn = document.getElementById("loginBtn");
    if (!username || !pw) return;
    btn.disabled = true; btn.textContent = "جارِ الدخول...";

    const hash = await sha256Hex(pw);

    try {
      const { data, error } = await supabaseClient.rpc('verify_admin_login', {
        p_username: username,
        p_password_hash: hash
      });

      if (error) throw error;

      if (data && data.length > 0) {
        state.currentAdmin = { username: data[0].username, role: data[0].role, passwordHash: hash };
        document.getElementById("loginErr").textContent = "";
        state.view = "admin";
        state.adminTab = data[0].role === "owner" ? "products" : "orders";
        render();
      } else {
        document.getElementById("loginErr").textContent = "اسم المستخدم أو كلمة المرور غير صحيحة";
        btn.disabled = false; btn.textContent = "دخول";
      }
    } catch (e) {
      console.error("login error", e);
      document.getElementById("loginErr").textContent = "تعذر الاتصال بالخادم، حاولي مجددًا";
      btn.disabled = false; btn.textContent = "دخول";
    }
  }
}

/* ---------- لوحة الإدارة ---------- */
function renderAdmin(){
  const isOwner = state.currentAdmin?.role === "owner";
  const roleLabel = isOwner ? "مديرة المتجر" : "مشرفة";

  const tabsHtml = isOwner
    ? `
      <button class="tab ${state.adminTab==='products'?'active':''}" data-tab="products">المنتجات</button>
      <button class="tab ${state.adminTab==='orders'?'active':''}" data-tab="orders">الحجوزات (${state.orders.length})</button>
      <button class="tab ${state.adminTab==='settings'?'active':''}" data-tab="settings">الإعدادات</button>
      <button class="tab ${state.adminTab==='admins'?'active':''}" data-tab="admins">المشرفات</button>
    `
    : `
      <button class="tab ${state.adminTab==='orders'?'active':''}" data-tab="orders">الحجوزات (${state.orders.length})</button>
      <button class="tab ${state.adminTab==='products'?'active':''}" data-tab="products">المنتجات</button>
    `;

  app.innerHTML = `
    <div class="wrap">
      <div class="admin-header">
        <h1 class="display" style="font-size:32px;margin:0;">لوحة قصّة <span class="role-badge">${roleLabel}</span></h1>
        <button class="ghost-btn" id="logoutBtn" style="width:auto;">خروج ⏏</button>
      </div>
      <div class="tabs">${tabsHtml}</div>
      <div id="adminBody"></div>
    </div>
  `;
  document.getElementById("logoutBtn").onclick = () => {
    state.currentAdmin = null;
    state.view = "store";
    render();
  };
  app.querySelectorAll("[data-tab]").forEach(btn=>{
    btn.onclick = () => { state.adminTab = btn.dataset.tab; render(); };
  });

  // حماية إضافية: منع الوصول لأي تبويب غير مصرح به حتى لو تم التلاعب بالحالة محليًا
  // المشرفة (staff) يُسمح لها فقط بـ orders و products (عرض فقط)
  if (!isOwner && state.adminTab !== "orders" && state.adminTab !== "products") state.adminTab = "orders";

  const body = document.getElementById("adminBody");
  if (state.adminTab === "products") {
    if (isOwner) renderProductsTab(body);
    else renderProductsReadOnly(body);
  }
  else if (state.adminTab === "orders") renderOrdersTab(body);
  else if (state.adminTab === "settings" && isOwner) renderSettingsTab(body);
  else if (state.adminTab === "admins" && isOwner) renderAdminsTab(body);
  else renderOrdersTab(body);
}

/* ---------- عرض المنتجات للمشرفة (قراءة فقط، بدون إضافة أو حذف) ---------- */
function renderProductsReadOnly(body){
  if (state.products.length === 0){
    body.innerHTML = `<p class="hint center" style="padding:30px 0;">لا توجد منتجات مضافة بعد.</p>`;
    return;
  }
  body.innerHTML = `<div id="prodListRO"></div>`;
  document.getElementById("prodListRO").innerHTML = state.products.map(p => {
    const prodImg = p.image ? '<img src="' + esc(p.image) + '">' : '<div class="ph"></div>';
    return `
      <div class="prod-row">
        ${prodImg}
        <div class="info"><h4>${esc(p.name)}</h4><p>${money(p.price)} د.ع${p.description ? " · " + esc(p.description) : ""}</p></div>
      </div>
    `;
  }).join("");
}

function renderProductsTab(body){
  let pendingImage = null;
  body.innerHTML = `
    <div class="panel">
      <h3>إضافة منتج جديد</h3>
      <input type="file" id="fileInput" accept="image/*" style="display:none">
      <div class="upload-box" id="uploadBox">📷 إضافة صورة المنتج</div>
      <input class="plain-input" id="pName" placeholder="اسم المنتج">
      <input class="plain-input" id="pPrice" placeholder="السعر (د.ع)" inputmode="numeric">
      <textarea class="plain-textarea" id="pDesc" placeholder="وصف مختصر (اختياري)" rows="2"></textarea>
      <button class="primary-btn" id="addBtn">+ إضافة المنتج</button>
    </div>
    <div id="prodList"></div>
  `;
  document.getElementById("uploadBox").onclick = () => document.getElementById("fileInput").click();
  document.getElementById("fileInput").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImage(file);
    pendingImage = dataUrl;
    document.getElementById("uploadBox").innerHTML = `<img src="${dataUrl}">`;
  };
  document.getElementById("pPrice").oninput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, "");
  };
  document.getElementById("addBtn").onclick = async () => {
    const name = document.getElementById("pName").value.trim();
    const price = document.getElementById("pPrice").value.trim();
    const desc = document.getElementById("pDesc").value.trim();
    if (!name || !price) return;
    const btn = document.getElementById("addBtn");
    btn.disabled = true; btn.textContent = "جارِ الحفظ...";

    const { error } = await supabaseClient
      .from('products')
      .insert([{ name, price: Number(price), description: desc, image: pendingImage }]);

    if (error) {
      console.error("Error inserting product:", error);
      showToast("تعذر إضافة المنتج: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "+ إضافة المنتج";
      return;
    }

    showToast("تمت إضافة المنتج بنجاح");
    await loadAll();
    renderAdmin();
  };

  const list = document.getElementById("prodList");
  if (state.products.length === 0){
    list.innerHTML = `<p class="hint center">لا توجد منتجات مضافة بعد.</p>`;
  } else {
    list.innerHTML = state.products.map(p => {
      const prodImg = p.image ? '<img src="' + esc(p.image) + '">' : '<div class="ph"></div>';
      return `
        <div class="prod-row">
          ${prodImg}
          <div class="info"><h4>${esc(p.name)}</h4><p>${money(p.price)} د.ع</p></div>
          <button class="del-btn" data-del="${p.id}">🗑</button>
        </div>
      `;
    }).join("");
    list.querySelectorAll("[data-del]").forEach(b => {
      b.onclick = async () => {
        const confirmDelete = confirm("هل أنت متأكد من حذف هذا المنتج؟");
        if (!confirmDelete) return;

        const { error } = await supabaseClient
          .from('products')
          .delete()
          .eq('id', b.dataset.del);

        if (error) {
          console.error("Error deleting product:", error);
          showToast("تعذر حذف المنتج: " + (error.message || "خطأ غير معروف"), "err");
          return;
        }

        showToast("تم حذف المنتج");
        await loadAll();
        renderAdmin();
      };
    });
  }
}

function renderOrdersTab(body){
  if (state.orders.length === 0){
    body.innerHTML = `<p class="hint center" style="padding:30px 0;">لا توجد حجوزات بعد.</p>`;
    return;
  }
  body.innerHTML = state.orders.map(o => {
    const orderImg = o.product_image ? '<img src="' + esc(o.product_image) + '">' : '<div class="ph"></div>';
    return `
      <div class="order-card">
        <div class="order-top">
          ${orderImg}
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;">${esc(o.product_name)} <span style="color:var(--muted);font-weight:400;">${o.qty ? `× ${o.qty}` : ''}</span></div>
            <div style="font-size:11px;color:var(--muted);">${new Date(o.created_at).toLocaleString("ar")}</div>
          </div>
          <div style="font-weight:700;font-size:14px;">${o.total ? money(o.total) + ' د.ع' : ''}</div>
        </div>
        <div class="order-details">
          <div>👤 ${esc(o.customer_name)}</div>
          <div>📍 ${esc(o.address || o.location)}</div>
          <div>📞 ${esc(o.phone_number || o.phone)}</div>
        </div>
      </div>
    `;
  }).join("");
}

function renderSettingsTab(body){
  body.innerHTML = `
    <div class="panel">
      <h3>رقم واتساب استلام الحجوزات</h3>
      <p class="hint">تُرسل كل تفاصيل الحجز تلقائيًا إلى هذا الرقم عبر واتساب. أدخل الرقم مع مفتاح الدولة (مثال: 9647701234567). هذا الرقم مشترك ويظهر فورًا على كل الأجهزة.</p>
      <input class="plain-input" id="waNum" value="${esc(state.settings.whatsapp)}" placeholder="9647xxxxxxxx" dir="ltr">
      <div class="err" id="waErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="saveWa">حفظ</button>
    </div>
    <div class="panel">
      <h3>تغيير كلمة مرور مديرة المتجر</h3>
      <input class="plain-input" id="oldPw" type="password" placeholder="كلمة المرور الحالية">
      <input class="plain-input" id="newPw" type="password" placeholder="كلمة المرور الجديدة">
      <div class="err" id="pwMsg" style="margin:-6px 0 10px;font-size:12px;"></div>
      <button class="dark-btn" id="savePw">حفظ كلمة المرور</button>
    </div>
  `;

  document.getElementById("saveWa").onclick = async () => {
    const val = document.getElementById("waNum").value.trim();
    if (val && !isValidWhatsapp(val)) {
      document.getElementById("waErr").textContent = "الرقم غير صالح، أدخله مع مفتاح الدولة بدون علامة + (مثال: 9647701234567)";
      return;
    }
    document.getElementById("waErr").textContent = "";
    const ok = await saveWhatsapp(formatWhatsapp(val));
    if (ok) showToast("تم حفظ الإعدادات");
    else showToast("تعذر الحفظ في السحابة، تم الحفظ محليًا فقط", "err");
  };

  document.getElementById("savePw").onclick = async () => {
    const oldPw = document.getElementById("oldPw").value;
    const newPw = document.getElementById("newPw").value.trim();
    const msgEl = document.getElementById("pwMsg");

    if (!newPw || newPw.length < 4) {
      msgEl.style.color = "var(--err)";
      msgEl.textContent = "كلمة المرور الجديدة يجب أن تكون 4 أحرف/أرقام على الأقل";
      return;
    }

    const oldHash = await sha256Hex(oldPw);
    const newHash = await sha256Hex(newPw);

    try {
      const { error } = await supabaseClient.rpc('change_owner_password', {
        p_owner_username: state.currentAdmin.username,
        p_old_password_hash: oldHash,
        p_new_password_hash: newHash
      });
      if (error) throw error;

      state.currentAdmin.passwordHash = newHash;
      document.getElementById("oldPw").value = "";
      document.getElementById("newPw").value = "";
      msgEl.style.color = "var(--moss)";
      msgEl.textContent = "تم تغيير كلمة المرور بنجاح ✓";
      showToast("تم تغيير كلمة المرور");
    } catch (e) {
      console.error("change password error", e);
      msgEl.style.color = "var(--err)";
      msgEl.textContent = "كلمة المرور الحالية غير صحيحة أو تعذر الاتصال";
    }
  };
}

/* ---------- تبويب إدارة المشرفات (owner فقط) ---------- */
async function renderAdminsTab(body){
  body.innerHTML = `
    <div class="panel">
      <h3>إضافة مشرفة جديدة</h3>
      <p class="hint">يمكن للمشرفة الجديدة مراجعة الحجوزات فقط، ولا تستطيع تغيير كلمة المرور أو رقم واتساب أو حذف/إضافة المنتجات.</p>
      <input class="plain-input" id="newUsr" placeholder="اسم مستخدم جديد">
      <input class="plain-input" id="newPw" type="password" placeholder="كلمة المرور">
      <div class="err" id="addAdminErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="addAdminBtn">+ إضافة مشرفة</button>
    </div>
    <div class="panel">
      <h3>المشرفات الحاليات</h3>
      <div id="staffList"><p class="hint center">جارِ التحميل...</p></div>
    </div>
  `;

  document.getElementById("addAdminBtn").onclick = async () => {
    const newUsr = document.getElementById("newUsr").value.trim();
    const newPw = document.getElementById("newPw").value;
    const errEl = document.getElementById("addAdminErr");
    errEl.textContent = "";
    if (!newUsr || newPw.length < 4) {
      errEl.textContent = "الرجاء إدخال اسم مستخدم وكلمة مرور لا تقل عن 4 أحرف";
      return;
    }
    const btn = document.getElementById("addAdminBtn");
    btn.disabled = true; btn.textContent = "جارِ الإضافة...";

    const newHash = await sha256Hex(newPw);
    try {
      const { error } = await supabaseClient.rpc('add_staff_admin', {
        p_owner_username: state.currentAdmin.username,
        p_owner_password_hash: state.currentAdmin.passwordHash,
        p_new_username: newUsr,
        p_new_password_hash: newHash
      });
      if (error) throw error;
      showToast("تمت إضافة المشرفة بنجاح");
      document.getElementById("newUsr").value = "";
      document.getElementById("newPw").value = "";
      await renderAdminsTab(body);
    } catch (e) {
      console.error("add admin error", e);
      errEl.textContent = e.message || "تعذر إضافة المشرفة";
    } finally {
      btn.disabled = false; btn.textContent = "+ إضافة مشرفة";
    }
  };

  try {
    const { data, error } = await supabaseClient.rpc('list_staff_admins', {
      p_owner_username: state.currentAdmin.username,
      p_owner_password_hash: state.currentAdmin.passwordHash
    });
    if (error) throw error;
    const listEl = document.getElementById("staffList");
    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="hint center">لا توجد مشرفات مضافة بعد.</p>`;
      return;
    }
    listEl.innerHTML = data.map(s => `
      <div class="staff-row">
        <div class="info">
          <h4>${esc(s.username)}</h4>
          <p>مراجعة الحجوزات فقط · أُضيفت ${new Date(s.created_at).toLocaleDateString("ar")}</p>
        </div>
        <button class="del-btn" data-removeusr="${esc(s.username)}">🗑</button>
      </div>
    `).join("");
    listEl.querySelectorAll("[data-removeusr]").forEach(b => {
      b.onclick = async () => {
        if (!confirm(`هل تريدين إزالة صلاحية ${b.dataset.removeusr}؟`)) return;
        try {
          const { error } = await supabaseClient.rpc('remove_staff_admin', {
            p_owner_username: state.currentAdmin.username,
            p_owner_password_hash: state.currentAdmin.passwordHash,
            p_target_username: b.dataset.removeusr
          });
          if (error) throw error;
          showToast("تمت الإزالة");
          await renderAdminsTab(body);
        } catch (e) {
          console.error("remove admin error", e);
          showToast("تعذر الإزالة", "err");
        }
      };
    });
  } catch (e) {
    console.error("list admins error", e);
    document.getElementById("staffList").innerHTML =
      `<p class="hint center">تعذر تحميل قائمة المشرفات.<br>${esc(e.message || "")}</p>`;
  }
}

/* ======================= جلب البيانات من Supabase ======================= */
async function loadAll(){
  try {
    const { data: dbProducts, error: prodErr } = await supabaseClient
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (!prodErr && dbProducts) {
      state.products = dbProducts;
    } else {
      state.products = loadLocal(KEYS.PRODUCTS, []);
    }

    const { data: dbOrders, error: ordErr } = await supabaseClient
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!ordErr && dbOrders) {
      state.orders = dbOrders;
    } else {
      state.orders = loadLocal(KEYS.ORDERS, []);
    }
  } catch (e) {
    console.error("Supabase load error, falling back to local:", e);
    state.products = loadLocal(KEYS.PRODUCTS, []);
    state.orders = loadLocal(KEYS.ORDERS, []);
  }
}

/* ======================= بدء التشغيل ======================= */
async function init(){
  await loadAll();
  await loadSettings();

  loadingEl.style.display = "none";
  app.style.display = "block";
  render();
}

init();
