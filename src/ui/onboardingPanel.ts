import * as vscode from "vscode";
import { signIn, getSession } from "../git/githubAuth";

let _panel: vscode.WebviewPanel | undefined;

function buildHtml(iconUri: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Code Reviewer</title>
<style>
@keyframes glow{0%,100%{box-shadow:0 0 18px #00d4b855,0 0 40px #00d4b822}50%{box-shadow:0 0 28px #00d4b888,0 0 60px #00d4b844}}
@keyframes fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{
  height:100%;
  background:radial-gradient(ellipse at 50% 30%, #0d1f3c 0%, #080d1a 70%);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;
}
/* Subtle grid background */
body::before{
  content:'';position:fixed;inset:0;
  background-image:linear-gradient(#00d4b808 1px,transparent 1px),linear-gradient(90deg,#00d4b808 1px,transparent 1px);
  background-size:40px 40px;
  pointer-events:none;
}
.card{
  background:linear-gradient(145deg,#0f1d35ee,#0a1120ee);
  border:1px solid #1e3a6e;
  border-radius:20px;
  padding:44px 40px 36px;
  width:380px;
  text-align:center;
  animation:fadeIn .5s ease-out;
  position:relative;
  box-shadow:0 0 0 1px #00d4b815,0 24px 64px #00000088,0 0 80px #6d5ef610;
}
/* Teal top accent line */
.card::before{
  content:'';position:absolute;top:0;left:10%;right:10%;height:2px;
  background:linear-gradient(90deg,transparent,#00d4b8,#6d5ef6,#00d4b8,transparent);
  border-radius:2px;
}
.owl-wrap{
  position:relative;display:inline-block;margin-bottom:20px;
}
.owl-wrap img{
  width:96px;height:96px;border-radius:22px;
  animation:glow 3s ease-in-out infinite;
  display:block;
}
.owl-fallback{font-size:80px;line-height:1;display:none}
h1{
  font-size:22px;font-weight:800;margin-bottom:6px;
  background:linear-gradient(135deg,#e2e8f0 30%,#00d4b8);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  letter-spacing:-.3px;
}
.tagline{
  color:#4a7fa5;font-size:12px;font-weight:600;letter-spacing:.12em;
  text-transform:uppercase;margin-bottom:10px;
}
.sub{color:#64748b;font-size:13px;line-height:1.65;margin-bottom:28px}
.sub b{color:#94a3b8}

/* GitHub sign-in button */
.gh-btn{
  display:flex;align-items:center;justify-content:center;gap:10px;
  width:100%;padding:13px 20px;
  background:linear-gradient(135deg,#00b89c,#00d4b8);
  border:none;border-radius:10px;
  color:#080d1a;font-size:14px;font-weight:700;
  cursor:pointer;
  transition:all .2s;
  box-shadow:0 4px 20px #00d4b840;
  letter-spacing:.01em;
}
.gh-btn:hover{
  background:linear-gradient(135deg,#00d4b8,#00e5cc);
  box-shadow:0 6px 28px #00d4b860;
  transform:translateY(-1px);
}
.gh-btn:active{transform:translateY(0)}
.gh-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.gh-icon{width:20px;height:20px;fill:#080d1a;flex-shrink:0}

.skip{
  margin-top:16px;color:#2a4a6b;font-size:12px;
  cursor:pointer;background:none;border:none;
  text-decoration:underline;text-underline-offset:3px;
  transition:color .15s;
}
.skip:hover{color:#4a7fa5}

/* Feature hints */
.hints{
  margin-top:24px;
  display:flex;flex-direction:column;gap:8px;
  text-align:left;
}
.hint-row{
  display:flex;align-items:center;gap:10px;
  padding:8px 12px;
  background:#ffffff04;
  border:1px solid #1e3a6e55;
  border-radius:8px;
  font-size:12px;color:#64748b;
}
.hint-icon{font-size:16px;flex-shrink:0}
.hint-row b{color:#00d4b8;font-weight:600}

/* Success state */
#success-view{display:none;animation:fadeIn .4s ease-out}
.success-ring{
  width:96px;height:96px;border-radius:50%;
  background:linear-gradient(135deg,#00d4b820,#6d5ef620);
  border:2px solid #00d4b8;
  display:flex;align-items:center;justify-content:center;
  margin:0 auto 20px;
  font-size:42px;
  box-shadow:0 0 30px #00d4b844;
}
.success-name{color:#00d4b8;font-weight:700}
.start-hint{
  margin-top:16px;padding:10px 14px;
  background:#00d4b808;border:1px solid #00d4b822;
  border-radius:8px;font-size:12px;color:#4a7fa5;
  font-family:monospace;letter-spacing:.02em;
}
</style></head><body>
<div class="card">

  <!-- Sign-in view -->
  <div id="sign-in-view">
    <div class="owl-wrap">
      <img src="${iconUri}" alt="AI Code Reviewer"
        onerror="this.style.display='none';document.querySelector('.owl-fallback').style.display='block'">
      <span class="owl-fallback">🦉</span>
    </div>
    <p class="tagline">9 AI agents · Code Review</p>
    <h1>AI Code Reviewer</h1>
    <p class="sub">Connect GitHub to post reviews directly<br>to your <b>Pull Requests</b>.</p>

    <button class="gh-btn" id="signin-btn" onclick="doSignIn()">
      <svg class="gh-icon" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Sign in with GitHub
    </button>
    <button class="skip" id="skip-btn" onclick="doSkip()">Skip for now</button>

    <div class="hints">
      <div class="hint-row"><span class="hint-icon">🔍</span><span><b>9 agents</b> review security, quality, complexity & more</span></div>
      <div class="hint-row"><span class="hint-icon">📬</span><span>Post full reviews as <b>PR comments</b> in one click</span></div>
      <div class="hint-row"><span class="hint-icon">⚡</span><span><b>Apply fixes</b> directly in your editor</span></div>
    </div>
  </div>

  <!-- Success view -->
  <div id="success-view">
    <div class="success-ring">✓</div>
    <h1>Connected!</h1>
    <p class="sub">Signed in as <span class="success-name" id="gh-login"></span></p>
    <div class="start-hint">Save any .ts or .py file to start reviewing →</div>
  </div>

</div>
<script>
const vscode=acquireVsCodeApi();
function doSignIn(){
  const btn=document.getElementById('signin-btn');
  const skip=document.getElementById('skip-btn');
  btn.disabled=true;
  btn.innerHTML='<svg style="width:18px;height:18px;fill:#080d1a;animation:pulse 1s infinite" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Connecting…';
  skip.style.display='none';
  vscode.postMessage({type:'githubLogin'});
}
function doSkip(){vscode.postMessage({type:'onboardingSkip'});}
window.addEventListener('message',ev=>{
  const d=ev.data;
  if(d.type==='githubConnected'){
    document.getElementById('sign-in-view').style.display='none';
    document.getElementById('success-view').style.display='block';
    document.getElementById('gh-login').textContent='@'+d.login;
    setTimeout(()=>vscode.postMessage({type:'onboardingDone'}),2500);
  }
  if(d.type==='githubLoginFailed'){
    const btn=document.getElementById('signin-btn');
    btn.disabled=false;
    btn.innerHTML='<svg class="gh-icon" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Sign in with GitHub';
    document.getElementById('skip-btn').style.display='inline';
  }
});
</script></body></html>`;
}

export async function showOnboardingPanel(context: vscode.ExtensionContext, force = false): Promise<void> {
  if (!force) {
    // If caller already restored a session, no need to show onboarding
    if (getSession()) { return; }

    // Already shown and skipped this session?
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
