import * as vscode from "vscode";
import { signIn, getSession } from "../git/githubAuth";

let _panel: vscode.WebviewPanel | undefined;

const GH_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`;

function buildHtml(iconUri: string): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Code Reviewer</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src vscode-resource: data: https:;">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@450&display=swap" rel="stylesheet">
<style>
@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{
  height:100%;background:#0D1117;color:#dfe2eb;
  font-family:'Inter',system-ui,sans-serif;font-size:13px;
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;
}
.card{
  width:100%;max-width:360px;
  background:#181c22;border:1px solid #30363D;border-radius:8px;
  padding:32px 28px 28px;
  animation:fadeIn .4s ease-out;
  box-shadow:0 0 20px rgba(201,84,32,.08);
  transition:border-color .3s;
}
.card:hover{border-color:rgba(201,84,32,.3)}
.logo-wrap{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:28px}
.logo-img{width:64px;height:64px;border-radius:12px;object-fit:contain;margin-bottom:16px;filter:drop-shadow(0 0 8px rgba(201,84,32,.25))}
.logo-fallback{font-size:48px;line-height:1;margin-bottom:16px;display:none}
h1{font-size:18px;font-weight:700;color:#dfe2eb;margin-bottom:4px;letter-spacing:-.01em}
.tagline{font-size:12px;color:#dfc0b5;opacity:.8}
.features{display:flex;flex-direction:column;gap:4px;margin-bottom:28px}
.feature-row{
  display:flex;align-items:center;gap:12px;
  padding:10px 12px;border-radius:6px;border:1px solid transparent;
  transition:background .15s;cursor:default;
}
.feature-row:hover{background:#161B22}
.feature-icon{
  width:32px;height:32px;border-radius:6px;font-size:16px;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.fi-orange{background:rgba(201,84,32,.12)}
.fi-green{background:rgba(39,166,64,.12)}
.fi-blue{background:rgba(255,181,153,.12)}
.feature-title{font-size:13px;font-weight:600;color:#dfe2eb;line-height:1.2}
.feature-sub{font-size:10px;color:#dfc0b5;opacity:.7;text-transform:uppercase;letter-spacing:.08em;margin-top:1px}
.btn-github{
  display:flex;align-items:center;justify-content:center;gap:10px;
  width:100%;height:44px;background:#C95420;color:#fff;
  border:none;border-radius:6px;font-size:13px;font-weight:700;
  cursor:pointer;font-family:inherit;transition:background .15s;margin-bottom:16px;
}
.btn-github:hover{background:#b04a1c}
.btn-github:active{transform:scale(.98)}
.btn-github:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-skip{
  display:flex;align-items:center;justify-content:center;
  width:100%;background:none;border:none;color:#dfc0b5;
  font-size:12px;cursor:pointer;font-family:inherit;opacity:.7;
  text-decoration:underline;text-underline-offset:3px;transition:opacity .15s;
}
.btn-skip:hover{opacity:1}
#success-view{display:none;text-align:center;animation:fadeIn .4s ease-out}
.success-icon{
  width:80px;height:80px;border-radius:50%;
  background:rgba(201,84,32,.1);border:2px solid #C95420;
  display:flex;align-items:center;justify-content:center;
  margin:0 auto 20px;font-size:36px;
  box-shadow:0 0 24px rgba(201,84,32,.3);
}
.success-name{color:#C95420;font-weight:700}
.start-hint{
  margin-top:20px;padding:10px 14px;
  background:rgba(201,84,32,.06);border:1px solid rgba(201,84,32,.15);
  border-radius:6px;font-size:12px;color:#dfc0b5;
  font-family:'JetBrains Mono',monospace;
}
.card-footer{
  margin-top:24px;padding-top:20px;
  border-top:1px solid rgba(48,54,61,.5);
  display:flex;align-items:center;justify-content:center;gap:6px;
}
.version{font-family:'JetBrains Mono',monospace;font-size:10px;color:#dfc0b5;opacity:.5}
</style></head><body>
<div class="card">
  <div id="sign-in-view">
    <div class="logo-wrap">
      <img src="${iconUri}" class="logo-img" alt="AI Code Reviewer"
        onerror="this.style.display='none';document.querySelector('.logo-fallback').style.display='block'">
      <span class="logo-fallback">🦊</span>
      <h1>AI Code Reviewer</h1>
      <p class="tagline">Multi-agent review in your editor</p>
    </div>
    <div class="features">
      <div class="feature-row">
        <div class="feature-icon fi-orange">🤖</div>
        <div><div class="feature-title">9+ AI Agents</div><div class="feature-sub">Expert logic analysis</div></div>
      </div>
      <div class="feature-row">
        <div class="feature-icon fi-green">🔒</div>
        <div><div class="feature-title">Security Analysis</div><div class="feature-sub">Deep vulnerability scanning</div></div>
      </div>
      <div class="feature-row">
        <div class="feature-icon fi-blue">⚡</div>
        <div><div class="feature-title">Instant Fixes</div><div class="feature-sub">One-click refactoring</div></div>
      </div>
    </div>
    <button class="btn-github" id="signin-btn">${GH_ICON} Sign in with GitHub</button>
    <button class="btn-skip" id="skip-btn">Skip for now</button>
    <div class="card-footer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="color:#dfc0b5;opacity:.4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <span class="version">v1.3.4</span>
    </div>
  </div>
  <div id="success-view">
    <div class="success-icon">✓</div>
    <h1 style="text-align:center;margin-bottom:8px">Connected!</h1>
    <p style="text-align:center;color:#dfc0b5;font-size:13px">Signed in as <span class="success-name" id="gh-login"></span></p>
    <div class="start-hint">Save any .ts or .py file to start reviewing →</div>
  </div>
</div>
<script>
const vscode=acquireVsCodeApi();
const signinBtn=document.getElementById('signin-btn');
const skipBtn=document.getElementById('skip-btn');
const GH_SVG='${GH_ICON.replace(/'/g, "\\'")}';
signinBtn.addEventListener('click',()=>{
  signinBtn.disabled=true;
  signinBtn.innerHTML=GH_SVG+' Connecting…';
  skipBtn.style.display='none';
  vscode.postMessage({type:'githubLogin'});
});
skipBtn.addEventListener('click',()=>vscode.postMessage({type:'onboardingSkip'}));
window.addEventListener('message',ev=>{
  const d=ev.data;
  if(d.type==='githubConnected'){
    document.getElementById('sign-in-view').style.display='none';
    document.getElementById('success-view').style.display='block';
    document.getElementById('gh-login').textContent='@'+d.login;
    setTimeout(()=>vscode.postMessage({type:'onboardingDone'}),2500);
  }
  if(d.type==='githubLoginFailed'){
    signinBtn.disabled=false;
    signinBtn.innerHTML=GH_SVG+' Sign in with GitHub';
    skipBtn.style.display='flex';
  }
});
</script></body></html>`;
}

export async function showOnboardingPanel(context: vscode.ExtensionContext, force = false): Promise<void> {
  if (!force) {
    if (getSession()) { return; }
    if (context.workspaceState.get("onboardingSkipped")) { return; }
  }

  if (_panel) { _panel.reveal(); return; }

  const iconPath = vscode.Uri.joinPath(context.extensionUri, "icon.png");
  _panel = vscode.window.createWebviewPanel(
    "aiReviewerOnboarding",
    "AI Code Reviewer — Sign in",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [context.extensionUri] }
  );
  const iconUri = _panel.webview.asWebviewUri(iconPath).toString();
  _panel.webview.html = buildHtml(iconUri);

  _panel.webview.onDidReceiveMessage(async msg => {
    if (msg.type === "githubLogin") {
      const session = await signIn();
      if (session) {
        context.globalState.update("githubExplicitlyConnected", true);
        _panel?.webview.postMessage({ type: "githubConnected", login: session.user.login });
      } else {
        _panel?.webview.postMessage({ type: "githubLoginFailed" });
        vscode.window.showWarningMessage("AI Reviewer: GitHub sign-in failed — check VS Code accounts.");
      }
    }
    if (msg.type === "onboardingDone" || msg.type === "onboardingSkip") {
      if (msg.type === "onboardingSkip") {
        context.workspaceState.update("onboardingSkipped", true);
      }
      _panel?.dispose();
    }
  });

  _panel.onDidDispose(() => { _panel = undefined; });
}
