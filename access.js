(function () {
  const URL = "https://imcwmrvtnucstizhkrhl.supabase.co";
  const KEY = "sb_publishable_gx32auqh2BrgkVFneXCMXw_V7GCjkTf";
  const client = window.supabase.createClient(URL, KEY);
  window.campaignClient = client;
  window.campaignMember = null;

  let finish;
  window.campaignAccessReady = new Promise(resolve => { finish = resolve; });

  const style = document.createElement("style");
  style.textContent = `
    #campaign-access-screen{position:fixed;inset:0;z-index:99999;background:#11131d;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif;color:#eee}
    #campaign-access-screen .access-card{width:min(440px,100%);background:#202433;border:1px solid #9c804d;border-radius:10px;padding:28px;box-shadow:0 18px 70px #0009}
    #campaign-access-screen h2{color:#e2c58e;margin:0 0 8px;font-family:Georgia,serif}
    #campaign-access-screen p{color:#b7bac6;font-size:13px;line-height:1.6}
    #campaign-access-screen input{box-sizing:border-box;width:100%;margin:7px 0 12px;padding:12px;background:#151925;color:#fff;border:1px solid #51586b;border-radius:5px}
    #campaign-access-screen button,.access-panel button{background:#d8bd87;color:#211d18;border:0;border-radius:5px;padding:11px 15px;font-weight:bold;cursor:pointer}
    #campaign-access-screen button{width:100%}
    #campaign-access-screen .access-error{color:#f08e8e;min-height:18px;font-size:12px}
    #campaign-access-screen .access-kicker{color:#c5a66e;letter-spacing:2px;font-size:10px;margin-bottom:12px}
    #campaign-account-button{margin-left:12px;background:transparent;color:#e2c58e;border:1px solid #8e7549;border-radius:4px;padding:7px 10px;font-size:10px;cursor:pointer}
    #campaign-account-panel{position:fixed;z-index:99998;inset:0;background:#000a;display:none;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif;color:#eee}
    #campaign-account-panel .access-panel{width:min(600px,100%);max-height:85vh;overflow:auto;background:#202433;border:1px solid #9c804d;border-radius:10px;padding:22px}
    #campaign-account-panel h3{color:#e2c58e;margin:8px 0}
    #campaign-account-panel input{box-sizing:border-box;width:100%;padding:10px;margin:5px 0 10px;background:#151925;color:white;border:1px solid #51586b;border-radius:5px}
    #campaign-account-panel button{margin:4px 4px 4px 0}
    #campaign-account-panel .member-row{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid #414657;padding:10px 0;font-size:12px}
    #campaign-account-panel .muted{color:#aeb3c2;font-size:12px}
    #campaign-account-panel .code-result{background:#151925;border:1px dashed #c5a66e;padding:12px;overflow-wrap:anywhere;color:#f0d69e}
    #campaign-account-panel .close-account{float:right;background:#414657;color:white}
  `;
  document.head.appendChild(style);

  function showLogin(message = "") {
    let screen = document.getElementById("campaign-access-screen");
    if (!screen) {
      screen = document.createElement("div");
      screen.id = "campaign-access-screen";
      screen.innerHTML = `<div class="access-card">
        <div class="access-kicker">THE ADVENTURERS' CHRONICLE</div>
        <h2>Enter the Campaign</h2>
        <p>This campaign is private. Enter the access code given to you by the Dungeon Master.</p>
        <form id="campaign-access-form">
          <input id="campaign-access-code" type="password" autocomplete="current-password" placeholder="Your campaign access code" required>
          <div class="access-error" id="campaign-access-error"></div>
          <button type="submit">ENTER CAMPAIGN</button>
        </form>
      </div>`;
      document.body.appendChild(screen);
      screen.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const button = screen.querySelector("button");
        const errorBox = screen.querySelector("#campaign-access-error");
        button.disabled = true;
        button.textContent = "CHECKING CODE...";
        errorBox.textContent = "";
        try {
          const code = screen.querySelector("#campaign-access-code").value.trim();
          const { data, error } = await client.functions.invoke("campaign-access", { body: { action: "redeem-code", code } });
          if (error) throw await readableError(error);
          const { error: authError } = await client.auth.verifyOtp({
            email: data.email, token_hash: data.token_hash, type: data.type || "magiclink"
          });
          if (authError) throw authError;
          await completeAccess();
        } catch (err) {
          errorBox.textContent = err.message || "That code could not be accepted.";
          button.disabled = false;
          button.textContent = "ENTER CAMPAIGN";
        }
      });
    }
    screen.style.display = "flex";
    screen.querySelector("#campaign-access-error").textContent = message;
  }

  async function readableError(error) {
    try {
      const body = await error.context.json();
      return new Error(body.error || error.message);
    } catch (_) { return new Error(error.message || "The request failed."); }
  }

  async function completeAccess() {
    const { data, error } = await client.functions.invoke("campaign-data", { body: { action: "load" } });
    if (error) throw await readableError(error);
    window.campaignMember = data.member;
    const screen = document.getElementById("campaign-access-screen");
    if (screen) screen.remove();
    addAccountButton();
    finish({ client, member: data.member });
  }

  function addAccountButton() {
    if (document.getElementById("campaign-account-button")) return;
    const status = document.querySelector("#dnd-hub .hub-status");
    if (!status) return;
    const button = document.createElement("button");
    button.id = "campaign-account-button";
    button.textContent = window.campaignMember.role === "dm" ? "DM CONTROL" : "ACCOUNT";
    button.addEventListener("click", openAccountPanel);
    status.appendChild(button);
  }

  function openAccountPanel() {
    let overlay = document.getElementById("campaign-account-panel");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "campaign-account-panel";
      overlay.innerHTML = '<div class="access-panel"><button class="close-account">CLOSE</button><div id="campaign-account-content"></div></div>';
      document.body.appendChild(overlay);
      overlay.querySelector(".close-account").addEventListener("click", () => overlay.style.display = "none");
      overlay.addEventListener("click", e => { if (e.target === overlay) overlay.style.display = "none"; });
    }
    overlay.style.display = "flex";
    renderAccountPanel();
  }

  async function accessAction(action, payload = {}) {
    const { data, error } = await client.functions.invoke("campaign-access", { body: { action, ...payload } });
    if (error) throw await readableError(error);
    return data;
  }

  async function renderAccountPanel() {
    const content = document.getElementById("campaign-account-content");
    if (!content) return;
    const isDM = window.campaignMember.role === "dm";
    content.innerHTML = `
      <div class="access-kicker">CAMPAIGN ACCOUNT</div>
      <h2>${escapeText(window.campaignMember.display_name)}</h2>
      <p class="muted">${isDM ? "Dungeon Master access" : "Player access"}</p>
      <h3>Change access code</h3>
      <form id="change-campaign-code">
        <input id="old-campaign-code" type="password" placeholder="Current access code" required>
        <input id="new-campaign-code" type="password" minlength="12" placeholder="New code (at least 12 characters)" required>
        <button type="submit">CHANGE MY CODE</button>
      </form>
      <div id="account-message" class="muted" aria-live="polite"></div>
      ${isDM ? `
        <hr><h3>Player access</h3>
        <form id="create-campaign-player">
          <input id="new-player-name" maxlength="80" placeholder="Player's name" required>
          <button type="submit">CREATE PLAYER CODE</button>
        </form>
        <div id="new-player-code-result"></div>
        <div id="campaign-player-list" class="muted">Loading player list...</div>
      ` : ""}
      <hr><button id="campaign-sign-out" class="close-account">SIGN OUT</button>
    `;
    content.querySelector("#change-campaign-code").addEventListener("submit", async e => {
      e.preventDefault();
      const message = content.querySelector("#account-message");
      try {
        await accessAction("change-code", {
          current_code: content.querySelector("#old-campaign-code").value,
          new_code: content.querySelector("#new-campaign-code").value
        });
        content.querySelector("#change-campaign-code").reset();
        message.textContent = "Your access code has been changed. The old code no longer works.";
      } catch (err) { message.textContent = err.message; }
    });
    content.querySelector("#campaign-sign-out").addEventListener("click", async () => {
      await client.auth.signOut();
      location.reload();
    });

    if (isDM) {
      content.querySelector("#create-campaign-player").addEventListener("submit", async e => {
        e.preventDefault();
        const result = content.querySelector("#new-player-code-result");
        try {
          const created = await accessAction("create-player", { display_name: content.querySelector("#new-player-name").value });
          content.querySelector("#create-campaign-player").reset();
          result.innerHTML = '<p class="muted">Give this code to the player. It is only shown once:</p><div class="code-result"></div>';
          result.querySelector(".code-result").textContent = created.code;
          await loadPlayers();
        } catch (err) { result.textContent = err.message; }
      });
      await loadPlayers();
    }
  }

  async function loadPlayers() {
    const list = document.getElementById("campaign-player-list");
    if (!list) return;
    try {
      const result = await accessAction("list-players");
      list.innerHTML = "";
      if (!result.players.length) { list.textContent = "No player accounts yet."; return; }
      result.players.forEach(player => {
        const row = document.createElement("div");
        row.className = "member-row";
        const name = document.createElement("span");
        name.textContent = player.display_name + (player.active ? "" : " — REVOKED");
        const actions = document.createElement("span");
        if (player.active) {
          const reset = document.createElement("button");
          reset.textContent = "RESET CODE";
          reset.addEventListener("click", async () => {
            try {
              const result = await accessAction("reset-player-code", { member_id: player.id });
              const code = document.createElement("div");
              code.className = "code-result";
              code.textContent = player.display_name + "'s new code: " + result.code;
              await loadPlayers();
              list.prepend(code);
            } catch (err) { alert(err.message); }
          });
          const revoke = document.createElement("button");
          revoke.textContent = "REVOKE";
          revoke.addEventListener("click", async () => {
            if (!confirm("Revoke " + player.display_name + "'s access?")) return;
            try { await accessAction("revoke-player", { member_id: player.id }); await loadPlayers(); }
            catch (err) { alert(err.message); }
          });
          actions.append(reset, revoke);
        }
        row.append(name, actions);
        list.appendChild(row);
      });
    } catch (err) { list.textContent = err.message; }
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  }

  async function start() {
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session) {
        try { await completeAccess(); return; }
        catch (_) { await client.auth.signOut(); }
      }
      showLogin();
    } catch (err) { showLogin(err.message); }
  }

  start();
})();
