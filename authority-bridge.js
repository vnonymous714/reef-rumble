/* Authoritative adapter for the ORIGINAL Reef Rumble renderer and account/store
   shell. It never settles a local collision, balance delta or slot RNG. */
(function () {
  "use strict";
  if (!window.RR_AUTHORITATIVE) return;
  const R = window.__reef,
    $ = (s) => document.querySelector(s),
    fmt = (n) => (n / 100).toFixed(2),
    uid = () =>
      crypto.randomUUID?.() ||
      "rr_" +
        Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
          n.toString(16),
        ).join("");
  let token = null,
    init = window.Telegram?.WebApp?.initData || "",
    state = null,
    busy = false,
    offset = 0,
    opening = false,
    currentOffer = null,
    shownDaily = null,
    epoch = 0;
  const seen = new Set(),
    now = () => Date.now() + offset,
    key = () => "reefrumble.v2.pending." + (state?.owner || "unknown");
  async function raw(path, body) {
    const r = await fetch(window.RR_API + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Reef-Protocol": "2",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({
        ...body,
        ...(!token && init ? { initData: init } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(data.error || "Request failed"), {
        status: r.status,
      });
    return data;
  }
  function apply(s) {
    if (state && (s.owner !== state.owner || s.seq < state.seq)) return;
    state = s;
    offset = s.now - Date.now();
    const events = (s.detail?.motion || []).filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    while (seen.size > 256) seen.delete(seen.values().next().value);
    R.authoritativeView.apply({
      ...s,
      detail: { ...s.detail, motion: events },
    });
    paintModes();
    if (currentOffer) paintQuotes();
    if (s.world.resultPending && !currentOffer && !opening) {
      opening = true;
      queueMicrotask(() => {
        showResult(s.world.lastBonus);
        opening = false;
      });
    } else if (
      !currentOffer &&
      !opening &&
      s.world.offers.some((o) => !o.consumed)
    ) {
      opening = true;
      R.authoritativeView.stop();
      queueMicrotask(() => {
        openBonus().finally(() => (opening = false));
      });
    }
  }
  async function command(command, more = {}) {
    if (busy || (!token && !init)) return null;
    busy = true;
    const requestEpoch = epoch,
      pendingKey = key();
    const pending = sessionStorage.getItem(pendingKey),
      body = pending
        ? { ...JSON.parse(pending), recoverOnly: true }
        : { command, ...more, id: uid(), seq: state?.seq };
    sessionStorage.setItem(pendingKey, JSON.stringify(body));
    try {
      const s = await raw("/api/v2/game", body);
      if (epoch !== requestEpoch) return null;
      apply(s);
      sessionStorage.removeItem(pendingKey);
      if (pending && body.command !== command) {
        R.toast(
          "Previous " + body.command + " recovered without another charge",
        );
        return null;
      }
      return s;
    } catch (e) {
      if (epoch !== requestEpoch) return null;
      if (e.status === 401) {
        window.__rrAuth?.expired?.();
        return null;
      }
      R.toast(e.message);
      if (e.status >= 400 && e.status < 500)
        sessionStorage.removeItem(pendingKey);
      if ([400, 409].includes(e.status)) {
        try {
          apply(await raw("/api/v2/game", { command: "state", id: uid() }));
        } catch {}
      }
      return null;
    } finally {
      if (epoch === requestEpoch) busy = false;
    }
  }
  async function refresh() {
    if (busy || (!token && !init)) return state;
    return command("state");
  }
  async function session(t) {
    if (t && t !== token) {
      epoch++;
      state = null;
      seen.clear();
      shownDaily = null;
      currentOffer = null;
      token = t;
    } else if (state) return refresh();
    const requestEpoch = epoch;
    if (!token && !init) return;
    const s = await raw("/api/v2/game", { command: "state", id: uid() });
    if (epoch !== requestEpoch) return;
    apply(s);
    const pending = sessionStorage.getItem(key());
    if (pending) await command("state");
    if (!state.world.resultPending && state.daily.due) dailyCheck();
  }
  async function fire(input) {
    if (!state || busy || opening || currentOffer || state.world.pausedAt)
      return;
    return command("launch", input);
  }
  async function activate(style) {
    const s = await command("activate", { style });
    if (s) R.toast(style.toUpperCase() + " · 6s active / 12s shared cooldown");
  }
  function paintModes() {
    if (!state) return;
    const n = now(),
      w = state.world;
    for (const name of ["arc", "plasma"]) {
      const el = $("#" + name + "Mode");
      if (!el) continue;
      const active = n < w.styleUntil && w.style === name;
      el.disabled =
        busy || n < w.cooldownUntil || n < w.laserUntil || !!w.pausedAt;
      el.setAttribute("aria-pressed", String(active));
      el.innerHTML =
        '<img alt="" src="assets/weapon-' +
        name +
        '.svg"><span>' +
        name.toUpperCase() +
        " · " +
        (active
          ? ((w.styleUntil - n) / 1000).toFixed(1) + "s"
          : n < w.cooldownUntil
            ? "WAIT " + Math.ceil((w.cooldownUntil - n) / 1000) + "s"
            : "6s") +
        "</span>";
    }
  }
  function ensureModal() {
    let m = $("#templeM");
    if (m) return m;
    m = document.createElement("div");
    m.id = "templeM";
    m.className = "modal";
    m.innerHTML =
      '<div class="sheet templeSheet"><h2>TEMPLE TREASURES</h2><div id="templeContent"></div></div>';
    document.body.append(m);
    return m;
  }
  function grid(result) {
    const symbols = [
      "gem_b",
      "chest",
      "minnow",
      "tang",
      "jelly",
      "turtle",
      "koi",
      "ray",
    ];
    return (
      '<div class="templeReels">' +
      result.grid
        .map(
          (col, c) =>
            '<div class="templeReel">' +
            col
              .map(
                (sym, row) =>
                  '<div class="templeCell ' +
                  (result.wins.some((w) => TempleBonus.LINES[w.line][c] === row)
                    ? "templeWin"
                    : "") +
                  '"><img alt="' +
                  (sym === 0
                    ? "Tide Jewel"
                    : sym === 1
                      ? "Temple Relic"
                      : "Reef symbol") +
                  '" src="assets/' +
                  symbols[sym] +
                  '.webp"></div>',
              )
              .join("") +
            "</div>",
        )
        .join("") +
      "</div>"
    );
  }
  function openModal() {
    ensureModal();
    window.__slotsBridge.open();
    R.authoritativeView.openModal("#templeM");
  }
  async function openBonus() {
    if (!state || busy) return;
    const offer = state.world.offers.find((o) => !o.consumed);
    if (!offer) {
      R.toast("Capture a Temple Crab for an optional bonus offer");
      return;
    }
    const s = await command(state.world.pausedAt ? "quote" : "pause", {
      offer: offer.id,
    });
    if (!s) return;
    currentOffer = offer.id;
    openModal();
    $("#templeContent").innerHTML =
      "<p>3 reels × 3 rows · FIVE lines: top, middle, bottom, both diagonals. One TOTAL paid stake. Optional play credits; skip is free.</p>" +
      grid(TempleBonus.outcome(0, 0, 10, s.period)) +
      '<div id="templeQuotes" class="templeQuotes"></div><p id="templeQuoteStatus"></p><p>50% zero · 49% three Tide Jewels: 1.2× · 1% three Temple Relics: 33.2× (Low Tide29.2×). Other symbols do not pay. Exactly50% NET PROFIT, not guaranteed session return. Stake minimum0.10, maximum12.00; maximum award398.40.</p><button id="templeRefresh">REFRESH QUOTE · REVIEW AGAIN</button><button id="templeSkip">SKIP · NO CHARGE</button>';
    $("#templeRefresh").onclick = async () => {
      await command("quote", { offer: currentOffer });
      paintQuotes();
    };
    $("#templeSkip").onclick = async () => {
      if (await command("skip", { offer: currentOffer })) {
        currentOffer = null;
        closeTemple();
      }
    };
    paintQuotes();
  }
  function paintQuotes() {
    if (!currentOffer || !$("#templeQuotes")) return;
    const offer = state.world.offers.find((o) => o.id === currentOffer),
      quotes = offer?.quotes || [],
      signature = JSON.stringify(
        quotes.map((q) => [
          q.id,
          q.expiresAt > now() &&
            q.balance === state.balance &&
            q.accountSeq === state.seq &&
            q.period === state.period,
        ]),
      );
    if ($("#templeQuotes").dataset.signature === signature) {
      const q = quotes[0];
      if (q && q.expiresAt > now())
        $("#templeQuoteStatus").textContent =
          "Exact " +
          q.period +
          "% table · expires in " +
          Math.ceil((q.expiresAt - now()) / 1000) +
          "s · Maximum loss is the displayed stake.";
      return;
    }
    $("#templeQuotes").dataset.signature = signature;
    $("#templeQuotes").replaceChildren();
    for (const q of quotes) {
      const b = document.createElement("button"),
        valid =
          q.expiresAt > now() &&
          q.balance === state.balance &&
          q.accountSeq === state.seq &&
          q.period === state.period;
      b.textContent =
        "SPIN " +
        { 1: "SMALL", 5: "MEDIUM", 10: "INSANE" }[q.tier] +
        " · " +
        fmt(q.stake) +
        " · MAX " +
        fmt(q.stake * (q.period === 88 ? 29.2 : 33.2));
      b.disabled = !valid || !q.stake;
      b.onclick = async () => {
        const s = await command("spin", { offer: currentOffer, quoteId: q.id });
        if (s) showResult(s.detail.bonus);
      };
      $("#templeQuotes").append(b);
    }
    const q = quotes[0],
      valid =
        q &&
        q.expiresAt > now() &&
        q.balance === state.balance &&
        q.accountSeq === state.seq &&
        q.period === state.period;
    $("#templeQuoteStatus").textContent = valid
      ? "Exact " +
        q.period +
        "% table · expires in " +
        Math.ceil((q.expiresAt - now()) / 1000) +
        "s · Maximum loss is the displayed stake."
      : "Quote expired/changed. Refresh, review the exact stake and paytable, then explicitly confirm.";
  }
  function showResult(result) {
    currentOffer = "settled";
    openModal();
    $("#templeContent").innerHTML =
      grid(result) +
      "<h3>Returned " +
      fmt(result.pay) +
      " · Net " +
      (result.net >= 0 ? "+" : "") +
      fmt(result.net) +
      '</h3><button id="templeDone">RETURN TO REEF</button>';
    $("#templeDone").onclick = async () => {
      if (await command("resume")) {
        currentOffer = null;
        closeTemple();
      }
    };
  }
  function closeTemple() {
    R.authoritativeView.closeModal($("#templeM"));
    window.__slotsBridge.close();
  }
  function dailyCheck() {
    if (
      !state ||
      !state.daily.due ||
      shownDaily === state.daily.day ||
      currentOffer
    )
      return;
    shownDaily = state.daily.day;
    R.authoritativeView.dailyOpen(
      true,
      Math.min(7, (state.world.streak || 0) + 1),
    );
  }
  async function dailySpin() {
    const s = await command("daily");
    if (s) R.authoritativeView.dailyResult(s.detail.daily);
  }
  window.ReefAuthority = {
    get ready() {
      return !!state;
    },
    get snapshot() {
      return state;
    },
    now,
    session,
    refresh,
    fire,
    activate,
    paintModes,
    openBonus,
    dailyCheck,
    dailySpin,
    stop() {
      epoch++;
      busy = false;
      token = null;
      state = null;
      currentOffer = null;
      seen.clear();
      shownDaily = null;
      R.authoritativeView.stop();
    },
  };
  setInterval(() => {
    if (state) {
      paintModes();
      if (currentOffer && currentOffer !== "settled") paintQuotes();
      if (!busy && !document.hidden) refresh();
    }
  }, 200);
  if (init) {
    try {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    } catch {}
    session(null).catch((e) => R.toast(e.message));
  }
})();
