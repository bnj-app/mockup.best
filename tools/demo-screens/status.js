// Fills the status bar: <div class="status" data-c="#fff"></div>
for (const el of document.querySelectorAll('.status')) {
  const c = el.dataset.c || '#000';
  el.style.color = c;
  el.innerHTML = `<span>9:41</span><span class="icons">
    <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="${c}"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="${c}"/><rect x="10" y="3" width="3" height="9" rx="1" fill="${c}"/><rect x="15" y="0" width="3" height="12" rx="1" fill="${c}"/></svg>
    <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .8 10.4 10.4 0 0 0 .8 3.7L2 5c1.6-1.5 3.7-2.4 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4.4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Zm0 3.6c-.6 0-1.2.3-1.6.7L8 12l1.6-1.5c-.4-.4-1-.7-1.6-.7Z" fill="${c}"/></svg>
    <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="${c}" stroke-opacity=".4" fill="none"/><rect x="2" y="2" width="18" height="9" rx="2" fill="${c}"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="${c}" fill-opacity=".45"/></svg>
  </span>`;
}
