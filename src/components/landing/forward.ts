/*
  The root landing page's first task: the editor moved to /editor/, so old share links (/#s=…,
  whose hash never reaches the server and requires browser-side redirection) and ?unlock= must go
  there. Emit an inline script to run before paint.
*/
export const FORWARD_SCRIPT = `(function(){var h=location.hash,s=location.search;if(h.indexOf('#s=')===0||s.indexOf('unlock=')>-1){location.replace('/editor/'+s+h);}})();`;
