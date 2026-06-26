import * as vscode from "vscode";
import * as crypto from "crypto";
import { getSession } from "../git/githubAuth";

function getNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "ai-reviewer.sidebar";
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case "analyze":
          vscode.commands.executeCommand("ai-reviewer.analyze");
          break;
        case "showWelcome":
          vscode.commands.executeCommand("ai-reviewer.showWelcome");
          break;
        case "signIn":
          vscode.commands.executeCommand("ai-reviewer.githubSignIn");
          break;
        case "signOut":
          vscode.commands.executeCommand("ai-reviewer.githubSignOut");
          break;
        case "quietSave":
          vscode.commands.executeCommand("ai-reviewer.quietSave");
          break;
      }
    });
  }

  refresh(): void {
    if (this._view) {
      this._view.webview.html = this._buildHtml(this._view.webview);
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const session = getSession();
    const ghBlock = session
      ? `<div class="gh-connected">
           <span class="dot"></span>
           <span>@${session.user.login}</span>
           <button class="btn-ghost" onclick="send('signOut')">Sign out</button>
         </div>`
      : `<button class="btn-primary" onclick="send('signIn')">
           <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
           Connect GitHub
         </button>`;

    const cspSource = webview.cspSource;
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  color:var(--vscode-foreground);
  background:var(--vscode-sideBar-background);
  padding:12px;
}
.logo{
  display:flex;align-items:center;gap:8px;
  padding-bottom:12px;
  border-bottom:1px solid var(--vscode-sideBar-border, #ffffff15);
  margin-bottom:14px;
}
.logo svg{width:22px;height:22px;color:#00d4b8}
.logo-text{font-size:12px;font-weight:700;color:#00d4b8;letter-spacing:.04em}
.logo-sub{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:1px}

section{margin-bottom:16px}
.section-label{
  font-size:10px;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground);
  margin-bottom:8px;
}

.btn-primary{
  display:flex;align-items:center;justify-content:center;gap:7px;
  width:100%;padding:8px 12px;
  background:#00d4b8;color:#080d1a;
  border:none;border-radius:6px;
  font-size:12px;font-weight:700;cursor:pointer;
  transition:background .15s;
}
.btn-primary svg{width:14px;height:14px}
.btn-primary:hover{background:#00e5cc}

.btn-action{
  display:flex;align-items:center;gap:8px;
  width:100%;padding:8px 10px;
  background:var(--vscode-button-secondaryBackground, #ffffff0d);
  border:1px solid var(--vscode-sideBar-border, #ffffff12);
  border-radius:6px;
  color:var(--vscode-foreground);
  font-size:12px;cursor:pointer;
  transition:background .15s;margin-bottom:6px;
  text-align:left;
}
.btn-action:hover{background:var(--vscode-button-secondaryHoverBackground, #ffffff18)}
.btn-action svg{width:14px;height:14px;flex-shrink:0;color:#00d4b8}
.btn-action .kbd{
  margin-left:auto;font-size:10px;
  color:var(--vscode-descriptionForeground);
  background:var(--vscode-keybindingLabel-background, #ffffff10);
  padding:1px 5px;border-radius:3px;
}

.gh-connected{
  display:flex;align-items:center;gap:6px;
  padding:7px 10px;
  background:#00d4b810;
  border:1px solid #00d4b830;
  border-radius:6px;
  font-size:12px;
}
.dot{width:7px;height:7px;border-radius:50%;background:#00d4b8;flex-shrink:0}
.btn-ghost{
  margin-left:auto;background:none;border:none;
  color:var(--vscode-descriptionForeground);
  font-size:11px;cursor:pointer;padding:0;
}
.btn-ghost:hover{color:var(--vscode-foreground)}

.tip{
  font-size:11px;color:var(--vscode-descriptionForeground);
  padding:8px 10px;
  background:var(--vscode-textBlockQuote-background, #ffffff08);
  border-left:2px solid #00d4b8;
  border-radius:0 4px 4px 0;
  line-height:1.5;
}
</style></head><body>

<div class="logo">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 21c-4 0-7-3-7-7V9c0-2.5 2-4 4-4h6c2 0 4 1.5 4 4v5c0 4-3 7-7 7z"/>
    <circle cx="9.5" cy="10" r="1.8"/><circle cx="14.5" cy="10" r="1.8"/>
    <path d="M11 13l1 1.5 1-1.5"/><path d="M8 5.5L6 3M16 5.5l2-3"/>
  </svg>
  <div>
    <div class="logo-text">AI Code Reviewer</div>
    <div class="logo-sub">9 agents · multi-provider</div>
  </div>
</div>

<section>
  <div class="section-label">GitHub</div>
  ${ghBlock}
</section>

<section>
  <div class="section-label">Actions</div>
  <button class="btn-action" onclick="send('analyze')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    Analyze current file
    <span class="kbd">Ctrl+S</span>
  </button>
  <button class="btn-action" onclick="send('quietSave')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
    Quiet save (no review)
    <span class="kbd">Ctrl+Shift+S</span>
  </button>
  <button class="btn-action" onclick="send('showWelcome')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
    Show welcome screen
  </button>
</section>

<div class="tip">Save any <strong>.ts</strong> or <strong>.py</strong> file to trigger a full review automatically.</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
function send(type){ vscode.postMessage({type}); }
</script>
</body></html>`;
  }
}
