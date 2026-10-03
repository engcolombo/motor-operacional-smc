// Keyboard access and announced state for the Pro presentation only.
(() => {
  const sync = () => {
    document.querySelectorAll('.mtab').forEach(el => { el.setAttribute('role','button'); el.tabIndex=0; el.setAttribute('aria-pressed',String(el.classList.contains('active'))); });
    document.querySelectorAll('.bhead').forEach(el => { el.setAttribute('role','button'); el.tabIndex=0; el.setAttribute('aria-expanded',String(el.closest('.block').classList.contains('open'))); });
    document.querySelectorAll('.item').forEach(el => { el.setAttribute('role','checkbox'); el.tabIndex=0; el.setAttribute('aria-checked',String(el.classList.contains('chk'))); });
  };
  document.addEventListener('keydown', e => {
    if ((e.key==='Enter' || e.key===' ') && e.target.matches('.mtab,.bhead,.item')) { e.preventDefault(); e.target.click(); }
  });
  new MutationObserver(sync).observe(document.getElementById('checklistMain'),{subtree:true,attributes:true,attributeFilter:['class']});
  sync();
})();
