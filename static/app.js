const __uv$config = { prefix: '/uv/', encodeUrl: Ultraviolet.codec.xor.encode, decodeUrl: Ultraviolet.codec.xor.decode, handler: '/uv/uv.handler.js', bundle: '/uv/uv.bundle.js', config: '/uv/uv.config.js', sw: '/uv/uv.sw.js' };
const form = document.getElementById('proxy-form'), urlInput = document.getElementById('url-input'), statusEl = document.getElementById('status');
function isValidUrl(s) { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } }
function setStatus(m, t = '') { statusEl.textContent = m; statusEl.className = 'status ' + t; if (t !== 'error') setTimeout(() => { if (statusEl.textContent === m) { statusEl.textContent = ''; statusEl.className = 'status'; } }, 3000); }
function getProxyUrl(target) { try { if (target.includes('/bare/')) return target; return `/bare/${__uv$config.encodeUrl(target)}`; } catch { return null; } }
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = urlInput.value.trim();
  if (!isValidUrl(raw)) { setStatus('❌ 有効なURLを入力してください', 'error'); urlInput.focus(); return; }
  const proxyUrl = getProxyUrl(raw);
  if (!proxyUrl) { setStatus('❌ URLの変更に失敗しました', 'error'); return; }
  setStatus('🔄 接続中...', '');
  window.location.href = proxyUrl;
});
document.addEventListener('DOMContentLoaded', () => { if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(r => { if (!r) console.warn('SW未登録'); }); urlInput.focus(); });