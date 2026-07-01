import * as vscode from "vscode";
import * as crypto from "crypto";
import { getSession } from "../git/githubAuth";
import { getSelectedRepo } from "../git/repoSelector";
import { setCachedKey } from "../core/config";
import type { OpenPR } from "../git/prList";
import type { RateLimitEntry } from "../pipeline/types";

const SECRET_KEYS: { id: string; label: string; secret: string }[] = [
  { id: "groq",      label: "Groq",      secret: "aiReviewer.groqApiKey"      },
  { id: "gemini",    label: "Gemini",    secret: "aiReviewer.geminiApiKey"    },
  { id: "nvidia",    label: "NVIDIA",    secret: "aiReviewer.nvidiaApiKey"    },
  { id: "cerebras",  label: "Cerebras",  secret: "aiReviewer.cerebrasApiKey"  },
  { id: "sambanova", label: "SambaNova", secret: "aiReviewer.sambanovaApiKey" },
];

function getNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "ai-reviewer.sidebar";
  private _view?:          vscode.WebviewView;
  private _prs:            OpenPR[]         = [];
  private _branch:         string           = "";
  private _branchWatcher:  vscode.Disposable | undefined;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  private _watchBranch(): void {
    this._branchWatcher?.dispose();
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (!gitExt) { return; }
    const api = gitExt.exports?.getAPI?.(1);
    if (!api) { return; }
    const attach = () => {
      const repo = api.repositories?.[0];
      if (!repo) { return; }
      const initial = repo.state.HEAD?.name ?? "";
      if (initial) { this._branch = initial; }
      this._branchWatcher = repo.state.onDidChange(() => {
        const name = repo.state.HEAD?.name ?? "";
        if (name && name !== this._branch) {
          this._branch = name;
          this._view?.webview.postMessage({ type: "branchChanged", name });
        }
      });
    };
    if (api.repositories?.length) { attach(); }
    else { api.onDidOpenRepository(() => attach()); }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    // Register listener BEFORE setting HTML so no message is missed
    webviewView.webview.onDidReceiveMessage(async msg => {
      switch (msg.type) {
        case "analyze":       vscode.commands.executeCommand("ai-reviewer.analyze");       break;
        case "showWelcome":   vscode.commands.executeCommand("ai-reviewer.showWelcome");   break;
        case "signIn":        vscode.commands.executeCommand("ai-reviewer.githubSignIn");  break;
        case "signOut":       vscode.commands.executeCommand("ai-reviewer.githubSignOut"); break;
        case "selectRepo":    vscode.commands.executeCommand("ai-reviewer.selectRepo");    break;
        case "quietSave":     vscode.commands.executeCommand("ai-reviewer.quietSave");     break;
        case "pushAndReview": vscode.commands.executeCommand("ai-reviewer.pushAndReview"); break;
        case "reviewPR":      vscode.commands.executeCommand("ai-reviewer.reviewPR");      break;
        case "refreshPRs":    this.refreshPRList().catch(console.error);                   break;
        case "switchBranch":
          await vscode.commands.executeCommand("git.checkout");
          this.refresh();
          break;
        case "getKeyStatuses": {
          const statuses: Record<string, boolean> = {};
          await Promise.all(SECRET_KEYS.map(async ({ id, secret }) => {
            const val = await this._context.secrets.get(secret);
            statuses[id] = !!val;
          }));
          webviewView.webview.postMessage({ type: "keyStatuses", statuses });
          break;
        }
        case "saveKey": {
          const entry = SECRET_KEYS.find(k => k.id === msg.provider);
          if (!entry) { break; }
          const val: string = msg.value ?? "";
          if (val.trim()) {
            await this._context.secrets.store(entry.secret, val.trim());
            setCachedKey(entry.secret.replace("aiReviewer.", ""), val.trim());
          } else {
            await this._context.secrets.delete(entry.secret);
            setCachedKey(entry.secret.replace("aiReviewer.", ""), "");
          }
          webviewView.webview.postMessage({ type: "keySaved", provider: msg.provider, set: !!val.trim() });
          break;
        }
        case "revealKey": {
          const entry = SECRET_KEYS.find(k => k.id === msg.provider);
          if (!entry) { break; }
          const val = await this._context.secrets.get(entry.secret) ?? "";
          webviewView.webview.postMessage({ type: "keyRevealed", provider: msg.provider, value: val });
          break;
        }
      }
    });

    webviewView.webview.html = this._buildHtml(webviewView.webview);
    try { this._watchBranch(); } catch (e) { console.error("_watchBranch:", e); }
  }

  refresh(): void {
    if (this._view) {
      this._view.webview.html = this._buildHtml(this._view.webview);
    }
  }

  pushRateLimits(_entries: RateLimitEntry[]): void { /* rate limit UI removed */ }

  async refreshPRList(): Promise<void> {
    const session  = getSession();
    const selected = getSelectedRepo();
    if (!session || !selected) { this._prs = []; this.refresh(); return; }
    try {
      const { fetchOpenPRs } = await import("../git/prList");
      const { getRepoToken } = await import("../git/githubAuth");
      const token = await getRepoToken() ?? session.token;
      this._prs = await fetchOpenPRs(token, selected.owner, selected.repo, session.user.login);
    } catch {
      this._prs = [];
    }
    this.refresh();
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce    = getNonce();
    const session  = getSession();
    const selected = getSelectedRepo();
    const csp      = webview.cspSource;
    const iconUri  = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "icon.png")
    ).toString();

    // ── Auth block ────────────────────────────────────────────────
    const authBlock = session
      ? [
          '<div class="auth-row">',
          '  <div class="auth-user">',
          '    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
          '    <span class="code">@' + session.user.login + '</span>',
          '  </div>',
          '  <button id="btn-signout" class="btn-ghost">Sign Out</button>',
          '</div>',
          selected
            ? '<div id="btn-selectrepo" class="repo-row">'
              + '<svg class="icon" style="color:#67df70" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z"/></svg>'
              + '<span class="repo-name">' + selected.fullName + '</span>'
              + '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg>'
              + '</div>'
            : '<button id="btn-selectrepo" class="btn-repo">'
              + '<svg class="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z"/></svg>'
              + 'Select repository'
              + '</button>',
        ].join("\n")
      : '<button id="btn-signin" class="btn-primary">'
        + '<svg class="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'
        + 'Connect GitHub'
        + '</button>';

    // ── PR rows ───────────────────────────────────────────────────
    const prRows = this._prs.length
      ? this._prs.map(pr => {
          const badge = pr.reviewRequested
            ? '<span class="badge badge-req">Review Required</span>'
            : '<span class="badge badge-ok">Open</span>';
          const title = pr.title.length > 40 ? pr.title.slice(0, 37) + "..." : pr.title;
          return '<div class="pr-card pr-click">'
            + '<div class="pr-top"><span class="pr-num">#' + pr.number + '</span>' + badge + '</div>'
            + '<p class="pr-title">' + title + '</p>'
            + '<div class="pr-author">'
            + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>'
            + '@' + pr.author + '</div>'
            + '</div>';
        }).join("")
      : '<div class="pr-empty">No open PRs</div>';

    // ── API key rows ──────────────────────────────────────────────
    const keyRows = SECRET_KEYS.map(({ id, label }) =>
      '<div class="key-row">'
      + '<div class="key-lbl-wrap"><span class="key-dot" id="dot-' + id + '"></span><span class="key-lbl">' + label + '</span></div>'
      + '<input class="key-input" id="input-' + id + '" type="password" placeholder="' + label + ' key…" autocomplete="off">'
      + '<button class="btn-eye" data-target="input-' + id + '">'
      + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      + '</button>'
      + '<button class="btn-save-key" data-provider="' + id + '">Save</button>'
      + '</div>'
    ).join("");

    // ── Main action buttons ───────────────────────────────────────
    const analyzeBtn =
      '<button class="btn-action" id="btn-analyze">'
      + '<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
      + 'Analyze current file<span class="kbd">Ctrl+S</span>'
      + '</button>';
    const quietBtn =
      '<button class="btn-action" id="btn-quietsave">'
      + '<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'
      + 'Quiet save<span class="kbd">Ctrl+Shift+S</span>'
      + '</button>';
    const welcomeBtn =
      '<button class="btn-action" id="btn-welcome">'
      + '<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
      + 'Show welcome screen'
      + '</button>';

    const actionsBlock = session
      ? '<div class="actions">'
        + '<button class="btn-push" id="btn-push">'
        + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
        + 'Push &amp; Review</button>'
        + analyzeBtn + quietBtn + welcomeBtn
        + '</div>'
        + '<div class="prs-section">'
        + '<div class="prs-header"><span class="section-lbl">Open Pull Requests</span>'
        + '<button class="btn-refresh" id="btn-refresh-prs">&#8635; refresh</button></div>'
        + prRows
        + '<button class="btn-review-pr" id="btn-review-pr">'
        + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        + 'Review a PR</button>'
        + '</div>'
      : '<div class="actions">' + analyzeBtn + quietBtn + welcomeBtn + '</div>';

    void nonce;
    return "<!DOCTYPE html><html lang=\"en\"><head>\n"
      + "<meta charset=\"UTF-8\">\n"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
      + "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src " + csp + " data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';\">\n"
      + "<style>\n"
      + "*{box-sizing:border-box;margin:0;padding:0}\n"
      + "::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#30363D;border-radius:3px}\n"
      + "body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#dfe2eb;background:#0D1117;display:flex;flex-direction:column;height:100vh;overflow-x:hidden;user-select:none}\n"
      + ".icon{width:14px;height:14px;flex-shrink:0}\n"
      // Header
      + "header{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #30363D;flex-shrink:0}\n"
      + ".logo-img{width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0}\n"
      + ".logo-title{font-size:14px;font-weight:700;color:#dfe2eb;line-height:1.2}\n"
      + ".logo-sub{font-size:11px;color:#dfc0b5;opacity:.7;margin-top:1px}\n"
      // Auth
      + ".auth-section{padding:10px 12px;background:#181c22;border-bottom:1px solid #30363D;flex-shrink:0;display:flex;flex-direction:column;gap:8px}\n"
      + ".auth-row{display:flex;align-items:center;justify-content:space-between}\n"
      + ".auth-user{display:flex;align-items:center;gap:6px;overflow:hidden;color:#dfc0b5}\n"
      + ".code{font-family:Consolas,'JetBrains Mono',monospace;font-size:12px;color:#dfe2eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n"
      + ".btn-ghost{background:none;border:1px solid #30363D;color:#dfc0b5;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:3px;cursor:pointer;transition:color .15s,border-color .15s;font-family:inherit}\n"
      + ".btn-ghost:hover{color:#dfe2eb;border-color:#484f58}\n"
      + ".repo-row{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#0D1117;border:1px solid #30363D;border-radius:4px;cursor:pointer;transition:border-color .15s}\n"
      + ".repo-row:hover{border-color:#C95420}\n"
      + ".repo-name{font-family:Consolas,'JetBrains Mono',monospace;font-size:12px;color:#dfe2eb;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n"
      + ".btn-repo{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;background:none;border:1px dashed #30363D;border-radius:4px;color:#dfc0b5;font-size:12px;cursor:pointer;transition:border-color .15s,color .15s;font-family:inherit}\n"
      + ".btn-repo:hover{border-color:#C95420;color:#C95420}\n"
      + ".btn-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:9px 16px;background:#C95420;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s;font-family:inherit}\n"
      + ".btn-primary:hover{background:#b04a1c}\n"
      // Actions
      + ".actions{padding:10px 12px;border-bottom:1px solid #30363D;flex-shrink:0}\n"
      + ".btn-push{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:9px 16px;margin-bottom:6px;background:#C95420;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 12px #C9542030;transition:background .15s,box-shadow .15s;font-family:inherit}\n"
      + ".btn-push:hover{background:#b04a1c;box-shadow:0 4px 20px #C9542050}\n"
      + ".btn-push:active{transform:scale(.98)}\n"
      + ".btn-action{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;background:transparent;border:none;border-radius:4px;color:#dfe2eb;font-size:13px;cursor:pointer;transition:background .15s;text-align:left;font-family:inherit}\n"
      + ".btn-action:hover{background:#161B22}\n"
      + ".ico{color:#dfc0b5;flex-shrink:0}\n"
      + ".btn-action:hover .ico{color:#dfe2eb}\n"
      + ".kbd{margin-left:auto;font-size:10px;font-family:Consolas,monospace;color:#dfc0b5;opacity:.5}\n"
      // PR section
      + ".prs-section{flex:1;overflow-y:auto;padding:10px 12px}\n"
      + ".prs-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}\n"
      + ".section-lbl{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#dfc0b5;opacity:.6}\n"
      + ".btn-refresh{background:none;border:none;cursor:pointer;color:#dfc0b5;font-size:10px;padding:2px 4px;border-radius:3px;transition:color .15s;font-family:inherit}\n"
      + ".btn-refresh:hover{color:#C95420}\n"
      + ".pr-card{padding:10px;margin-bottom:6px;background:#181c22;border:1px solid #30363D;border-radius:4px;cursor:pointer;transition:background .15s;position:relative;overflow:hidden}\n"
      + ".pr-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:#C95420;opacity:0;transition:opacity .15s}\n"
      + ".pr-card:hover{background:#161B22}.pr-card:hover::before{opacity:1}\n"
      + ".pr-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}\n"
      + ".pr-num{font-family:Consolas,monospace;font-size:11px;color:#67df70;font-weight:600}\n"
      + ".badge{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:3px}\n"
      + ".badge-req{background:#93000a33;color:#ffb4ab}.badge-ok{background:#27a64033;color:#67df70}\n"
      + ".pr-title{font-size:12px;color:#dfe2eb;margin-bottom:4px;line-height:1.4}\n"
      + ".pr-author{display:flex;align-items:center;gap:4px;font-size:11px;color:#dfc0b5;opacity:.7}\n"
      + ".pr-empty{font-size:12px;color:#dfc0b5;opacity:.5;padding:16px 8px;text-align:center}\n"
      + ".btn-review-pr{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:8px;padding:8px;background:none;border:1px dashed #30363D;border-radius:4px;color:#dfc0b5;font-size:12px;cursor:pointer;transition:border-color .15s,color .15s;font-family:inherit}\n"
      + ".btn-review-pr:hover{border-color:#C95420;color:#C95420}\n"
      // API Keys
      + "details.keys{border-top:1px solid #30363D;flex-shrink:0}\n"
      + ".keys-summary{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;list-style:none;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#dfc0b5;opacity:.75;user-select:none}\n"
      + ".keys-summary:hover{opacity:1}\n"
      + ".keys-summary::marker,.keys-summary::-webkit-details-marker{display:none}\n"
      + ".keys-body{padding:4px 12px 10px}\n"
      + ".key-row{display:grid;grid-template-columns:72px 1fr auto auto;align-items:center;gap:5px;margin-bottom:6px}\n"
      + ".key-lbl-wrap{display:flex;align-items:center;gap:5px}\n"
      + ".key-dot{width:7px;height:7px;border-radius:50%;background:#30363D;flex-shrink:0;transition:background .3s}\n"
      + ".key-dot.set{background:#67df70}.key-dot.unset{background:#ff6b6b}\n"
      + ".key-lbl{font-size:11px;font-weight:600;color:#dfc0b5}\n"
      + ".key-input{background:#0D1117;border:1px solid #30363D;border-radius:4px;color:#dfe2eb;font-size:11px;font-family:Consolas,monospace;padding:4px 7px;width:100%;outline:none;transition:border-color .15s}\n"
      + ".key-input:focus{border-color:#C95420}\n"
      + ".btn-eye{background:none;border:none;cursor:pointer;color:#dfc0b5;padding:2px 4px;display:flex;align-items:center;transition:color .15s}\n"
      + ".btn-eye:hover{color:#dfe2eb}\n"
      + ".btn-save-key{background:#C95420;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:700;padding:4px 8px;cursor:pointer;transition:background .15s;font-family:inherit}\n"
      + ".btn-save-key:hover{background:#b04a1c}\n"
      + ".key-toast{font-size:10px;color:#67df70;text-align:center;margin-top:4px;height:14px;transition:opacity .3s}\n"
      // Footer
      + "footer{padding:8px 12px;border-top:1px solid #30363D;background:#10141a;flex-shrink:0}\n"
      + ".tip{display:flex;align-items:flex-start;gap:6px;font-size:11px;color:#dfc0b5;opacity:.6;line-height:1.5;font-style:italic}\n"
      + "</style></head><body>\n"

      + "<header>\n"
      + "  <img src=\"" + iconUri + "\" class=\"logo-img\" alt=\"\" onerror=\"this.style.display='none'\">\n"
      + "  <div><div class=\"logo-title\">AI Code Reviewer</div><div class=\"logo-sub\">9 agents &middot; multi-provider</div></div>\n"
      + "</header>\n"

      + "<section class=\"auth-section\">\n"
      + authBlock + "\n"
      + "</section>\n"

      + actionsBlock + "\n"

      + "<details class=\"keys\">\n"
      + "  <summary class=\"keys-summary\">\n"
      + "    <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4\"/></svg>\n"
      + "    API Keys\n"
      + "  </summary>\n"
      + "  <div class=\"keys-body\">\n"
      + keyRows + "\n"
      + "    <div class=\"key-toast\" id=\"key-toast\"></div>\n"
      + "  </div>\n"
      + "</details>\n"

      + "<footer>\n"
      + "  <div class=\"tip\">\n"
      + "    <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"color:#C95420;flex-shrink:0;margin-top:1px\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"12\" y1=\"16\" x2=\"12\" y2=\"12\"/><line x1=\"12\" y1=\"8\" x2=\"12.01\" y2=\"8\"/></svg>\n"
      + "    Save any .ts or .py file to trigger a full review automatically.\n"
      + "  </div>\n"
      + "</footer>\n"

      + "<script>\n"
      + "var vscode = acquireVsCodeApi();\n"
      + "function send(t) { vscode.postMessage({ type: t }); }\n"
      + "function $(id) { return document.getElementById(id); }\n"
      + "$('btn-signin')  && $('btn-signin').addEventListener('click',        function(){ send('signIn'); });\n"
      + "$('btn-signout') && $('btn-signout').addEventListener('click',       function(){ send('signOut'); });\n"
      + "$('btn-selectrepo') && $('btn-selectrepo').addEventListener('click', function(){ send('selectRepo'); });\n"
      + "$('btn-analyze') && $('btn-analyze').addEventListener('click',       function(){ send('analyze'); });\n"
      + "$('btn-quietsave') && $('btn-quietsave').addEventListener('click',   function(){ send('quietSave'); });\n"
      + "$('btn-welcome') && $('btn-welcome').addEventListener('click',       function(){ send('showWelcome'); });\n"
      + "$('btn-push') && $('btn-push').addEventListener('click',             function(){ send('pushAndReview'); });\n"
      + "$('btn-review-pr') && $('btn-review-pr').addEventListener('click',   function(){ send('reviewPR'); });\n"
      + "$('btn-refresh-prs') && $('btn-refresh-prs').addEventListener('click', function(){ send('refreshPRs'); });\n"
      + "document.querySelectorAll('.pr-click').forEach(function(el){ el.addEventListener('click', function(){ send('reviewPR'); }); });\n"
      + "vscode.postMessage({ type: 'getKeyStatuses' });\n"
      + "window.addEventListener('message', function(ev) {\n"
      + "  var msg = ev.data;\n"
      + "  if (msg.type === 'keyStatuses') {\n"
      + "    Object.keys(msg.statuses).forEach(function(id) {\n"
      + "      var dot = $('dot-' + id);\n"
      + "      if (dot) { dot.className = 'key-dot ' + (msg.statuses[id] ? 'set' : 'unset'); }\n"
      + "    });\n"
      + "  }\n"
      + "  if (msg.type === 'keySaved') {\n"
      + "    var dot = $('dot-' + msg.provider);\n"
      + "    if (dot) { dot.className = 'key-dot ' + (msg.set ? 'set' : 'unset'); }\n"
      + "    var inp = $('input-' + msg.provider);\n"
      + "    if (inp && msg.set) { inp.value = ''; inp.placeholder = '(saved)'; }\n"
      + "    showToast(msg.set ? 'Saved' : 'Cleared');\n"
      + "  }\n"
      + "  if (msg.type === 'keyRevealed') {\n"
      + "    var inp = $('input-' + msg.provider);\n"
      + "    if (inp) { inp.value = msg.value; inp.type = 'text'; }\n"
      + "  }\n"
      + "});\n"
      + "function showToast(text) {\n"
      + "  var t = $('key-toast');\n"
      + "  if (!t) { return; }\n"
      + "  t.textContent = text;\n"
      + "  t.style.opacity = '1';\n"
      + "  clearTimeout(t._tid);\n"
      + "  t._tid = setTimeout(function(){ t.style.opacity = '0'; }, 2000);\n"
      + "}\n"
      + "document.querySelectorAll('.btn-save-key').forEach(function(btn) {\n"
      + "  btn.addEventListener('click', function() {\n"
      + "    var id = btn.dataset.provider;\n"
      + "    var inp = $('input-' + id);\n"
      + "    vscode.postMessage({ type: 'saveKey', provider: id, value: inp ? inp.value : '' });\n"
      + "  });\n"
      + "});\n"
      + "document.querySelectorAll('.btn-eye').forEach(function(btn) {\n"
      + "  btn.addEventListener('click', function() {\n"
      + "    var tgt = btn.dataset.target;\n"
      + "    var inp = $(tgt);\n"
      + "    if (!inp) { return; }\n"
      + "    if (inp.value) {\n"
      + "      inp.type = inp.type === 'password' ? 'text' : 'password';\n"
      + "    } else {\n"
      + "      vscode.postMessage({ type: 'revealKey', provider: tgt.replace('input-', '') });\n"
      + "    }\n"
      + "  });\n"
      + "});\n"
      + "</script>\n"
      + "</body></html>";
  }
}
