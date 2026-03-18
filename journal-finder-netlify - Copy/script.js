let journals = [];
let filteredResults = [];
const USD_TO_INR = 83;


const API_URL = "https://script.google.com/macros/s/AKfycbzoLVuQjc6IsUebP8Pu9WgdJKTZ9ChgJj1ulKF3awdoo8IpBfyn8etu4SPHMa4T_8Zy/exec";


function openAddModal() { document.getElementById("addModal").classList.add("open"); }
function closeAddModal() { document.getElementById("addModal").classList.remove("open"); }

async function saveNewJournal() {
    const name = document.getElementById("newJName").value;
    const area = document.getElementById("newJArea").value;

    if (!name || !area) { alert("Name and Subject Area are required"); return; }

    const saveBtn = document.querySelector(".btn-save");
    saveBtn.innerText = "Saving...";
    saveBtn.disabled = true;

    // --- CRASH PROOF HELPER ---
    // This prevents the code from freezing if an ID is missing in HTML
    const getCheck = (id) => {
        const el = document.getElementById(id);
        return el && el.checked ? "Yes" : "No";
    };

    // Create Data Object
    const newRow = {
        "Journal Name": name,
        "Subject Area": area,
        "Publisher": document.getElementById("newJPub").value,
        "ISSN No": document.getElementById("newJIssn").value,
        "Country": document.getElementById("newJCountry").value,
        "Time": document.getElementById("newJTime").value,
        "Impact Factor": document.getElementById("newJImpact").value,
        "Acceptance Rate": document.getElementById("newJAcc").value + "%",
        "USD": document.getElementById("newJUSD").value,
        "Rs": document.getElementById("newJINR").value,
        "Editor": document.getElementById("newJEditor").value,
        "Co-Editor": document.getElementById("newJCoEditor").value,
        "Aim & Scope": document.getElementById("newJAim").value,
        "Guide Lines of Journal": document.getElementById("newJGuide").value,

        // Safe Checks
        "Hybrid": getCheck("newJHybrid"),
        "SCI": getCheck("newJSCI"),
        "WoS": getCheck("newJWoS"),
        "Annexure": getCheck("newJAnnex"),
        "Scopus": getCheck("newJScopus"),
        "Non Indexing": getCheck("newJNon"),
        "Subscription": getCheck("newJSub"),

        "Q1": getCheck("newJQ1"),
        "Q2": getCheck("newJQ2"),
        "Q3": getCheck("newJQ3"),
        "Q4": getCheck("newJQ4"),

        "Access": document.getElementById("newJOA").value
    };

    // 1. Add to local journals array immediately (optimistic update)
    const journalObj = normalizeJournal(newRow);
    journals.unshift(journalObj);

    // 2. Save updated list to IndexedDB cache (so it survives page reload)
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(journals, "all_journals");
    } catch (e) { console.warn("IDB save failed:", e); }

    // 3. Show the new journal immediately in results
    populateAreaFilter();
    document.getElementById("searchInput").value = name;
    document.getElementById("searchType").value = "journal";
    applyFilters();
    closeAddModal();

    // 4. Send to Google Sheet in background (10s timeout — button resets either way)
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        await fetch(API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: [newRow] }),
            signal: controller.signal
        });
        clearTimeout(timeout);
        console.log("✅ Saved to Google Sheet successfully!");
    } catch (error) {
        if (error.name === "AbortError") {
            console.warn("⚠️ Save timed out — journal saved locally only.");
        } else {
            console.error("Save Error:", error);
        }
    } finally {
        saveBtn.innerText = "Save Journal";
        saveBtn.disabled = false;

        // Clear all modal inputs
        document.querySelectorAll(".modal-body input, .modal-body textarea, .modal-body select").forEach(el => el.value = "");
        document.querySelectorAll(".modal-body input[type=checkbox]").forEach(el => el.checked = false);
    }
}

// --- 3. DATA NORMALIZATION (Optimized) ---
function normalizeJournal(row) {
    // Helper to safely get value from raw row (case-insensitive key search)
    const get = (targetKeys) => {
        const key = Object.keys(row).find(k =>
            targetKeys.some(t => k.toLowerCase().includes(t.toLowerCase()))
        );
        return row[key] ? String(row[key]).trim() : "";
    };

    const clean = {};

    // Core identification
    clean["Journal Name"] = get(["Journal Name", "Title", "Name"]) || "Unknown Journal";
    clean["ISSN No"] = get(["ISSN"]);
    clean["Publisher"] = get(["Publisher"]);
    clean["Subject Area"] = get(["Subject Area", "Area"]);
    clean["Country"] = get(["Country"]);

    // Metrics
    clean["Impact Factor"] = get(["Impact Factor", "Impact"]);
    clean["Acceptance Rate"] = get(["Acceptance Rate"]);
    clean["Time"] = get(["Time", "Duration"]);
    clean.__time = clean["Time"];
    clean.__impVal = parseFloat(clean["Impact Factor"].replace(/[^0-9.]/g, "")) || 0;

    // Details for Modal
    clean["Editor"] = get(["Editor"]);
    clean["Co-Editor"] = get(["Co-Editor"]);
    clean["Aim & Scope"] = get(["Aim", "Scope"]);
    clean["Guide Lines of Journal"] = get(["Guide"]);
    clean["USD"] = get(["USD"]);
    clean["Rs"] = get(["Rs", "INR"]);

    // Computed / Helper fields for Filters
    clean.__areas = (clean["Subject Area"] || "General")
        .split(/[,;&\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 2);

    clean.__quartiles = [];
    const uniqueQs = new Set();
    ["Q1", "Q2", "Q3", "Q4"].forEach(q => {
        if (get([q]).toLowerCase().includes("yes")) uniqueQs.add(q);
        if (get(["Quartile"]).includes(q)) uniqueQs.add(q);
    });
    clean.__quartiles = Array.from(uniqueQs);

    const isTrue = (val) => val.toLowerCase().includes("yes") || val.toLowerCase().includes("true");

    const indexingIdx = get(["Indexing"]).toLowerCase();
    clean.__isSCI = isTrue(get(["SCI"])) || indexingIdx.includes("sci");
    clean.__isWoS = isTrue(get(["WoS"])) || indexingIdx.includes("wos");
    clean.__isAnnexure = isTrue(get(["Annexure"])) || indexingIdx.includes("annex");
    clean.__isHybrid = isTrue(get(["Hybrid"])) || get(["Mode"]).toLowerCase().includes("hybrid");
    clean.__isNon = isTrue(get(["Non Indexing"])) || indexingIdx.includes("non");

    const subVal = get(["Subscription", "Mode", "Type"]).toLowerCase();
    clean.__isSubscription = subVal.includes("subscription") || isTrue(get(["Subscription"]));

    const oaVal = get(["Access", "Open"]).toLowerCase();
    if (oaVal.includes("gold")) clean.__oa = "Gold";
    else if (oaVal.includes("diamond")) clean.__oa = "Diamond";
    else clean.__oa = null;

    clean.__availText = [];
    if (clean.__isSCI) clean.__availText.push("SCI");
    if (clean.__isWoS) clean.__availText.push("WoS");
    if (clean.__isAnnexure) clean.__availText.push("Annexure");
    if (clean.__isNon) clean.__availText.push("Non-Indexing");

    // Color Hash
    const n = clean["Journal Name"];
    clean.__colorHash = (n.length * 50) % 360;

    return clean;
}

// --- INDEXED DB HELPERS (For >5MB Storage) ---
const DB_NAME = "JournalFinder_DB";
const DB_VERSION = 1;
const STORE_NAME = "journals";

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function saveToDB(data) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(data, "all_journals");
        return tx.complete;
    } catch (e) {
        console.error("IDB Save Failed", e);
    }
}

async function loadFromDB() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const request = store.get("all_journals");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    } catch (e) {
        console.error("IDB Load Failed", e);
        return null;
    }
}

async function loadJournals() {
    const countLabel = document.getElementById("resultCount");
    const badge = document.getElementById("totalJournalsBadge");

    // Deduplicate strictly by name and ISSN to prevent any duplicates
    function dedupe(list) {
        const seenNames = new Set();
        const seenIssns = new Set();
        return list.filter(j => {
            const rawName = (j["Journal Name"] || "").toLowerCase();
            // Remove all spaces and punctuation for a bulletproof name comparison
            const nameKey = rawName.replace(/[^a-z0-9]/g, "");
            
            const rawIssn = (j["ISSN No"] || "").toLowerCase();
            const issnKey = rawIssn.replace(/[^a-z0-9]/g, "");

            if (!nameKey) return false;

            // If it has a real ISSN and we already saw it -> duplicate
            if (issnKey.length > 4 && seenIssns.has(issnKey)) return false;
            
            // If we've seen this exact normalized name -> duplicate
            if (seenNames.has(nameKey)) return false;

            seenNames.add(nameKey);
            if (issnKey.length > 4) seenIssns.add(issnKey);
            
            return true;
        });
    }

    function updateBadge(count) {
        if (badge) { badge.style.display = "inline-block"; badge.innerText = `${count} Journals Available`; }
    }

    // STEP A: Show cached/local data instantly (fast first paint)
    let shownLocal = false;
    const cachedData = await loadFromDB();
    if (cachedData && cachedData.length > 0) {
        journals = dedupe(cachedData);
        populateAreaFilter();
        updateBadge(journals.length);
        if (countLabel) countLabel.innerText = "⏳ Checking for new data...";
        shownLocal = true;
    } else {
        try {
            const localResp = await fetch("./journals.json");
            if (localResp.ok) {
                const localRaw = await localResp.json();
                journals = dedupe(localRaw.map(row => normalizeJournal(row)));
                populateAreaFilter();
                if (countLabel) countLabel.innerText = "Enter search term or select a filter to begin.";
                shownLocal = true;
            }
        } catch (e) { console.warn("Local JSON load failed:", e); }
    }

    // STEP B: ALWAYS fetch fresh data from Google Sheets (cache-busted)
    try {
        console.log("Fetching latest data from Google Sheets...");
        const response = await fetch(API_URL + "?t=" + Date.now());
        if (!response.ok) throw new Error("API Response Not OK");

        const data = await response.json();
        const freshJournals = dedupe(data.map(row => normalizeJournal(row)));

        if (freshJournals.length > 0) {
            journals = freshJournals;
            window.bm25Index = null; // Invalidate cached BM25 index when data refreshes

            // Save to IDB cache
            try {
                const db = await openDB();
                const tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).put(journals, "all_journals");
            } catch (e) { console.warn("IDB Save Failed", e); }

            populateAreaFilter();

            // If user is searching, re-run with fresh data; otherwise stay blank
            const searchInput = document.getElementById("searchInput");
            const hasChecks = document.querySelectorAll("input[type=checkbox]:checked").length > 0;
            if (searchInput && searchInput.value.trim() !== "") {
                applyFilters(); // Re-run active search with new data
            } else if (hasChecks) {
                applyFilters(); // Re-run active filters with new data
            } else {
                if (countLabel) countLabel.innerText = "Enter search term or select a filter to begin.";
            }
            console.log(`✅ Loaded ${journals.length} journals from Google Sheets.`);
        }

        if (window.lucide) lucide.createIcons();
    } catch (error) {
        console.warn("API fetch failed (using cached data):", error);
        if (countLabel) countLabel.innerText = shownLocal
            ? "Enter search term or select a filter to begin."
            : "⚠️ Could not connect. Showing cached data.";
    }
}

// --- 4. SEARCH & FILTERS ---
function handleSearchInput(e) {
    const input = e.target;
    let val = input.value;
    const type = document.getElementById("searchType").value;
    const suggestionBox = document.getElementById("searchSuggestions");

    toggleClearBtn();

    if (type === "area") {
        if (/\d/.test(val)) { input.value = val.replace(/\d/g, ""); val = input.value; }
        if (val.length > 0) {
            const allAreas = [...new Set(journals.flatMap(j => j.__areas))];
            const matches = allAreas.filter(a => a.toLowerCase().includes(val.toLowerCase())).slice(0, 8);
            if (matches.length > 0) {
                suggestionBox.innerHTML = matches.map(m => `<div class="suggestion-item" onclick="selectSuggestion('${m}')">${m}</div>`).join("");
                suggestionBox.classList.add("active");
            } else suggestionBox.classList.remove("active");
        } else suggestionBox.classList.remove("active");
    } else suggestionBox.classList.remove("active");
}

function selectSuggestion(val) {
    document.getElementById("searchInput").value = val;
    document.getElementById("searchSuggestions").classList.remove("active");
    applySearch();
}

function handleEnterKey(event) { if (event.key === "Enter") applySearch(); }

// --- FIXED SIDEBAR FILTER FUNCTIONS ---

function populateAreaFilter() {
    // 1. Get unique areas, sort them
    const all = [...new Set(journals.flatMap(j => j.__areas))].sort();

    const list = document.getElementById("subjectCheckboxList");
    if (!list) return;

    // 2. Create the HTML with a specific class (.cb-label) for easier searching
    list.innerHTML = all.map(a => `
        <label class="custom-checkbox" style="display: flex;">
            <input type="checkbox" value="${a}" class="area-filter" onchange="applyFilters()">
            <span class="checkmark"></span> 
            <span class="cb-label">${a}</span>
        </label>
    `).join("");
}

function filterAreaCheckboxes() {
    // 1. Get the search input
    const input = document.getElementById("areaFilterSearch");
    if (!input) return;

    const term = input.value.toLowerCase().trim();
    const labels = document.querySelectorAll("#subjectCheckboxList label");

    // 2. Loop through list and toggle visibility
    labels.forEach(l => {
        // Find the text specifically inside the label span
        const span = l.querySelector(".cb-label");
        const text = span ? span.textContent.toLowerCase() : l.textContent.toLowerCase();

        // 3. Show/Hide
        // 3. Show/Hide
        if (text.startsWith(term)) {
            l.style.display = "flex";
        } else {
            l.style.display = "none";
        }
    });
}

function applySearch() { applyFilters(); }

// ─── BM25 ABSTRACT SEARCH ────────────────────────────────────────────────────
// Compact stop-word set (common English + academic filler words)
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','if','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','shall','should','may','might','must','can','could',
  'not','no','nor','so','yet','both','either','each','few','more','most',
  'other','some','such','than','then','that','this','these','those','when',
  'where','who','which','how','what','why','all','any','into','from','by',
  'about','above','after','before','between','both','down','up','out','off',
  'over','under','again','further','once','here','there','their','they',
  'them','its','our','your','his','her','we','he','she','it','i','me','my',
  'as','also','well','just','been','per','via','et','al','using','used',
  'based','among','while','since','across','during','through','within',
  'paper','journal','study','research','work','article','present','shows',
  'review','propose','provide','approach','method','results','analysis',
  'system','data','use','new','high','large','small','different','various',
  'thus','however','therefore','although','include','including','without',
  'including','between','current','existing','proposed','given','many',
  'along','focus','focuses','related','general','show','demonstrated'
]);

// Lightweight suffix stemmer (strip common English suffixes for better matching)
function stem(word) {
  if (word.length < 5) return word;
  // Order matters: try longest suffixes first
  const suffixes = ['ization','isation','ations','nesses','ments','ities',
                    'ation','izing','ising','ness','ment','ical','ity',
                    'ies','ing','ers','ous','ive','ful','ion','ed','er','ly','es','s'];
  for (const s of suffixes) {
    if (word.endsWith(s) && word.length - s.length >= 4) {
      return word.slice(0, word.length - s.length);
    }
  }
  return word;
}

// Tokenize text → array of meaningful stemmed tokens
function tokenize(text) {
  return text.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    .map(stem);
}

// Build BM25 index over all journals (lazy, cached in window.bm25Index)
function buildBM25Index() {
  if (window.bm25Index) return window.bm25Index;

  const k1 = 1.5, b = 0.75;
  const N = journals.length;
  const df = {};      // document frequency per stemmed term
  const docs = [];    // tokenized scope per journal
  let totalLen = 0;

  journals.forEach(j => {
    const tokens = tokenize(safeStr(j['Aim & Scope']));
    docs.push(tokens);
    totalLen += tokens.length;
    const unique = new Set(tokens);
    unique.forEach(t => { df[t] = (df[t] || 0) + 1; });
  });

  const avgdl = totalLen / (N || 1);

  // Pre-compute IDF for each term
  const idf = {};
  Object.keys(df).forEach(t => {
    idf[t] = Math.log((N - df[t] + 0.5) / (df[t] + 0.5) + 1);
  });

  window.bm25Index = { docs, idf, avgdl, k1, b };
  return window.bm25Index;
}

// Score a single journal document against a query token array using BM25
function bm25Score(docTokens, queryTokens, idf, avgdl, k1, b) {
  const tf = {};
  docTokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
  const dl = docTokens.length;
  let score = 0;
  queryTokens.forEach(qt => {
    if (tf[qt] === undefined) return;
    const tfVal = tf[qt];
    const idfVal = idf[qt] || 0;
    score += idfVal * (tfVal * (k1 + 1)) / (tfVal + k1 * (1 - b + b * dl / avgdl));
  });
  return score;
}
// ─────────────────────────────────────────────────────────────────────────────

function applyFilters() {
    //let rawInput = document.getElementById("searchInput").value.trim().toLowerCase();
    const input = document.getElementById("searchInput").value.trim().toLowerCase();
    const type = document.getElementById("searchType").value;
    const hasChecks = document.querySelectorAll("input[type=checkbox]:checked").length > 0;

    if (input === "" && !hasChecks) {
        filteredResults = [];
        renderResults([]);
        document.getElementById("resultCount").innerText = "Enter search term or select a filter to begin.";
        return;
    }

    // ── For abstract search, run BM25 scoring and return early ──────────────
    if (type === "aim" && input.length > 0) {
        const { docs, idf, avgdl, k1, b } = buildBM25Index();
        const queryTokens = tokenize(input);

        if (queryTokens.length === 0) {
            renderResults([]);
            document.getElementById("resultCount").innerText = "Abstract too generic — try adding domain-specific terms.";
            return;
        }

        // Score every journal against the abstract
        const scored = journals.map((j, idx) => {
            const score = bm25Score(docs[idx], queryTokens, idf, avgdl, k1, b);
            const aimScope = safeStr(j['Aim & Scope']).toLowerCase();
            const isExactMatch = aimScope.includes(input);
            j.__matchScore = score;
            return { j, score, isExactMatch };
        });

        // Separate Exact Matches and Partial Matches
        const exactMatches = scored.filter(s => s.isExactMatch).sort((a, b) => b.score - a.score);
        const partialMatches = scored.filter(s => !s.isExactMatch).sort((a, b) => b.score - a.score);

        // --- Fine-Tuned Relevance Filter ---
        // Calculate thresholds based on the top PARTIAL match to let "irrelevant" or fallback journals come next
        const maxPartialScore = partialMatches.length > 0 ? partialMatches[0].score : 0;

        // Relaxed thresholds to show more fallback options as requested
        const relativeThreshold = maxPartialScore * 0.30; 
        const absoluteFloor = 1.0; 
        const threshold = Math.max(absoluteFloor, relativeThreshold);

        const matchedPartial = [];
        let prevScore = maxPartialScore;
        for (const s of partialMatches) {
            if (s.score < threshold) break;           // Below quality floor
            if (prevScore > 0 && s.score < prevScore * 0.40) break; // Allowed 60% dropoff instead of 50%
            matchedPartial.push(s);
            prevScore = s.score;
            if (exactMatches.length + matchedPartial.length >= 100) break;
        }

        // Combine EXACT matches first, then PARTIAL matches
        const finalMatched = [...exactMatches, ...matchedPartial].slice(0, 100).map(s => s.j);

        filteredResults = finalMatched;
        
        // Set count label BEFORE renderResults (pass true so it isn't overwritten)
        const bm25Label = finalMatched.length > 0
            ? `Found ${finalMatched.length} journal${finalMatched.length > 1 ? 's' : ''} matching your abstract`
            : "No journals matched your abstract — try different or fewer terms.";
        document.getElementById("resultCount").innerText = bm25Label;
        renderResults(finalMatched, true);
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    let results = [...journals];

    if (input.length > 0) {
        document.getElementById("searchSuggestions").classList.remove("active");
        results = results.filter(j => {
            const name = safeStr(j["Journal Name"]);
            if (type === "journal") return input.length === 1 ? name.startsWith(input) : name.includes(input);
            if (type === "area") return j.__areas.some(area => area.toLowerCase().includes(input));
            //if (type === "issn") return safeStr(j["ISSN No"]).replace(/[^0-9xX]/g, "").includes(input);
            if (type === "publisher") return safeStr(j["Publisher"]).includes(input);
            if (type === "keywords") {
                const scope = safeStr(j["Aim & Scope"]).toLowerCase();
                let terms = input.includes(',') ? input.split(',') : input.split(/\s+/);
                terms = terms.map(w => w.trim()).filter(w => w.length > 0);
                
                if (terms.length === 0) return scope.includes(input);
                
                let matchCount = 0;
                for (let i = 0; i < terms.length; i++) {
                    if (scope.includes(terms[i])) matchCount++;
                }
                
                if (matchCount > 0) {
                    j.__matchScore = matchCount;
                    return true;
                }
                return false;
            }
            if (type === "country") return safeStr(j["Country"]).startsWith(input);
            // 👇 STRICT ISSN LOGIC ---------------------------
            if (type === "issn") {
                // User Request: "Numbers only work". "Letters should not appear".

                // Remove dashes from BOTH the database data AND your input
                // ISSN usually numbers + 'X'.
                const cleanData = safeStr(j["ISSN No"]).replace(/[^0-9xX]/g, "");
                const cleanInput = input.replace(/[^0-9xX]/g, "");

                // If the cleaned input is empty (meaning user typed only "abc" or symbols),
                // we must return FALSE so we show 0 results (instead of all).
                if (cleanInput.length === 0) return false;

                return cleanData.toLowerCase().includes(cleanInput);
            }
            if (type === "subscription") {
                // Strip currency symbols, keep digits and dash
                const cleanInput = input.replace(/[^0-9\-]/g, "");
                if (!cleanInput) return false;

                // Get raw USD and INR values from the journal
                const usdStr = String(j["USD"] || "").replace(/[^0-9.]/g, "");
                const inrStr = String(j["Rs"] || "").replace(/[^0-9.]/g, "");
                const usdVal = parseFloat(usdStr) || null;
                const inrVal = parseFloat(inrStr) || null;

                if (!usdVal && !inrVal) return false;

                if (cleanInput.includes("-")) {
                    const parts = cleanInput.split("-");
                    const min = parseFloat(parts[0]) || 0;
                    const max = parseFloat(parts[1]) || 99999999;
                    // Match if USD falls in range OR INR falls in range
                    if (usdVal && usdVal >= min && usdVal <= max) return true;
                    if (inrVal && inrVal >= min && inrVal <= max) return true;
                    return false;
                }
                // Single number: match if USD or INR is <= that amount
                const maxVal = parseFloat(cleanInput);
                if (usdVal && usdVal <= maxVal) return true;
                if (inrVal && inrVal <= maxVal) return true;
                return false;
            }
            return false;
        });
    }

    const areas = Array.from(document.querySelectorAll(".area-filter:checked")).map(cb => cb.value);
    if (areas.length) results = results.filter(j => j.__areas.some(a => areas.includes(a)));

    const qs = Array.from(document.querySelectorAll(".q-filter:checked")).map(cb => cb.value);
    if (qs.length) results = results.filter(j => j.__quartiles.some(q => qs.includes(q)));

    const idx = Array.from(document.querySelectorAll(".idx-filter:checked")).map(cb => cb.value);
    if (idx.length) {
        results = results.filter(j => {
            if (idx.includes("wos") && j.__isWoS) return true;
            if (idx.includes("sci") && j.__isSCI) return true;
            if (idx.includes("annexure") && j.__isAnnexure) return true;
            if (idx.includes("non") && j.__isNon) return true;
            return false;
        });
    }

    if (document.querySelector(".mode-filter:checked")) results = results.filter(j => j.__isHybrid);

    const oa = Array.from(document.querySelectorAll(".oa-filter:checked")).map(cb => cb.value);
    if (oa.length) results = results.filter(j => oa.includes(getOpenAccess(j).toLowerCase()));

    if (document.getElementById("highImpactFilter").checked) results = results.filter(j => j.__impVal >= 2.0);
    if (document.getElementById("subFilter").checked) results = results.filter(j => j.__isSubscription);

    const s = document.getElementById("sortType").value;
    if (s === "az" || s === "za") {
        results.sort((a, b) => {
            const nA = (a["Journal Name"] || "").trim();
            const nB = (b["Journal Name"] || "").trim();
            const isNumA = /^\d/.test(nA);
            const isNumB = /^\d/.test(nB);

            if (isNumA && !isNumB) return 1;
            if (!isNumA && isNumB) return -1;

            return s === "az"
                ? nA.localeCompare(nB)
                : nB.localeCompare(nA);
        });
    }
    else if (s === "ifHigh") results.sort((a, b) => b.__impVal - a.__impVal);
    else if (s === "accHigh") results.sort((a, b) => parseFloat(b["Acceptance Rate"] || 0) - parseFloat(a["Acceptance Rate"] || 0));
    else if (s === "timeFast") results.sort((a, b) => (parseInt(a.__time) || 999) - (parseInt(b.__time) || 999));
    else if (!s && (type === "aim" || type === "keywords") && input.length > 0) {
        results.sort((a, b) => (b.__matchScore || 0) - (a.__matchScore || 0));
    }

    renderResults(results);
}

// --- 5. RENDER RESULTS ---
function renderResults(data, customCountLabel) {
    const box = document.getElementById("results");

    if (!data || data.length === 0) {
        box.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b;">No journals found matching criteria.</div>`;
        if (!customCountLabel) document.getElementById("resultCount").innerText = `Found 0 journals`;
        return;
    }

    if (!customCountLabel) document.getElementById("resultCount").innerText = `Found ${data.length} journals`;

    const searchInput = document.getElementById("searchInput").value.trim();
    const searchType = document.getElementById("searchType").value;
    const highlight = (text, typeToCheck) => {
        if (!text || searchType !== typeToCheck || !searchInput) return text || "";
        if (searchType === "aim") return text;
        
        let regexTerms = searchInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (searchType === "keywords") {
            let terms = searchInput.includes(',') ? searchInput.split(',') : searchInput.split(/\s+/);
            terms = terms.map(t => t.trim()).filter(t => t.length > 0);
            if (terms.length > 0) {
                regexTerms = terms.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            }
        }
        const regex = new RegExp(`(${regexTerms})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    };

    const html = data.slice(0, 100).map(j => {
        let badges = "";
        j.__quartiles.forEach(q => badges += `<span class="badge badge-q1">${q}</span>`);
        if (j.__isSCI) badges += `<span class="badge badge-sci">SCI</span>`;
        if (j.__isWoS) badges += `<span class="badge badge-wos">WoS</span>`;
        if (j.__isAnnexure) badges += `<span class="badge badge-ann">Annexure</span>`;

        // Custom Styles for Non-Indexing and Subscription
        if (j.__isNon) badges += `<span class="badge" style="background-color: #475569; color: #f1f5f9; border: 1px solid #334155;">Non-Indexing</span>`;
        if (j.__isSubscription) badges += `<span class="badge" style="background-color: #d97706; color: white; border: 1px solid #b45309;">Subscription</span>`;

        if (j.__oa) badges += `<span class="badge badge-oa">${j.__oa}</span>`;

        const name = highlight(safe(j["Journal Name"]), "journal");
        let areaText = j.__areas.join(", ");
        if (searchType === "area" && searchInput) {
            const regex = new RegExp(`(${searchInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            areaText = areaText.replace(regex, '<mark>$1</mark>');
        }

        let availHtml = "";
        if (j.__availText.length > 0) {
            availHtml = `<div class="available-section"><span class="available-label">Available In:</span><div class="available-list">${j.__availText.map(t => `<span class="avail-tag"><i data-lucide="check-circle" class="avail-icon"></i> ${t}</span>`).join("")}</div></div>`;
        }


        return `
        <div class="card">
            <div class="card-cover" style="background: linear-gradient(${j.__colorHash}deg, hsl(${j.__colorHash}, 70%, 90%), hsl(${j.__colorHash}, 70%, 95%));"></div>
            <div class="card-body">
                <div class="card-top">
                    <div class="card-header-row">
                        <div class="card-badges">${badges}</div>
                        <span class="issn-box">ISSN: ${safe(j["ISSN No"])}</span>
                    </div>
                    <h3 class="card-title">${name}</h3>
                    <div class="card-publisher">
                        <i data-lucide="building-2" width="14"></i> 
                        <strong>Publisher:</strong> ${safe(j["Publisher"])}
                    </div>
                </div>

                <div class="metrics-strip">
                    <div class="stat-box"><span class="stat-label">Impact Factor</span><span class="stat-value">${safe(j["Impact Factor"])}</span></div>
                    <div class="stat-box"><span class="stat-label">Acceptance Rate</span><span class="stat-value">${safe(j["Acceptance Rate"])}</span></div>
                    <div class="stat-box"><span class="stat-label">Publication Duration</span><span class="stat-value">${safe(j.__time)}</span></div>
                    <div class="stat-box"><span class="stat-label">Usd/Inr</span><span class="stat-value">${getPayment(j)}</span></div>
                </div>

                <div class="meta-info">
                    <div class="meta-row">
                        <div class="meta-item"><i data-lucide="globe" width="14"></i> <strong>Country:</strong> ${safe(j["Country"])}</div>
                        <div class="meta-item"><i data-lucide="layers" width="14"></i> <strong>Hybrid Mode:</strong> ${j.__isHybrid ? "Yes" : "No"}</div>
                    </div>
                    <div class="meta-row">
                        <div class="meta-item" style="align-items:flex-start">
                            <i data-lucide="book-marked" width="14" style="margin-top:2px"></i> 
                            <span><strong>Area Of Interest:</strong> ${areaText}</span>
                        </div>
                    </div>
                    <div class="meta-row">
                        <div class="meta-item"><i data-lucide="user" width="14"></i> <strong>Editor:</strong> ${safe(j["Editor"])}</div>
                        <div class="meta-item"><i data-lucide="users" width="14"></i> <strong>Co-Editor:</strong> ${safe(j["Co-Editor"])}</div>
                    </div>
                    ${availHtml}
                </div>

                <details>
                    <summary></summary>
                    <div class="details-inner">
                        <h4>Aim & Scope</h4><p>${highlight(safe(j["Aim & Scope"]), searchType === "keywords" ? "keywords" : "aim")}</p>
                        <h4>Guidelines Of Journal</h4><p>${safe(j["Guide Lines of Journal"])}</p>
                    </div>
                </details>
            </div>
        </div>`;
    }).join("");

    box.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

// --- 6. HELPERS   FUNCTIONS ---
function getINR(j) {
    const rs = String(j["Rs"] || "").toLowerCase();
    const usd = String(j["USD"] || "").toLowerCase();
    if (rs.includes("free") || usd.includes("free") || rs.includes("no fee")) return 0;

    const rsVal = parseFloat(rs.replace(/[^0-9.]/g, ""));
    const usdVal = parseFloat(usd.replace(/[^0-9.]/g, ""));

    if (!isNaN(rsVal)) return rsVal;
    if (!isNaN(usdVal)) return usdVal * USD_TO_INR;
    return 99999999;
}

function safe(v) { return v && v.toString().trim() !== "" ? v : "—"; }
function safeStr(val) { return val ? String(val).toLowerCase().trim() : ""; }
function getPayment(j) {
    const p = [];
    if (j["USD"]) p.push(`$${j["USD"]}`);
    if (j["Rs"]) p.push(`₹${j["Rs"]}`);
    return p.length ? p.join(" / ") : "Free / NA";
}
function getOpenAccess(j) { return j.__oa ? j.__oa : "—"; }

function toggleClearBtn() {
    const v = document.getElementById("searchInput").value;
    document.getElementById("clearSearchBtn").style.display = v.length > 0 ? "flex" : "none";
    if (v.length === 0) {
        document.getElementById("searchSuggestions").classList.remove("active");
        applyFilters();
    }
}

function clearSearchInput() {
    document.getElementById("searchInput").value = "";
    toggleClearBtn();
    document.getElementById("searchSuggestions").classList.remove("active");
    applyFilters();
    document.getElementById("searchInput").focus();
}

// --- 7. RESET FILTERS ---
function clearAllFilters() {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.value = "";
        document.getElementById("searchSuggestions").classList.remove("active");
        toggleClearBtn();
    }

    document.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.checked = false;
    });

    const searchType = document.getElementById("searchType");
    if (searchType) searchType.value = "journal";

    const sortType = document.getElementById("sortType");
    if (sortType) sortType.value = "az";

    const areaFilterSearch = document.getElementById("areaFilterSearch");
    if (areaFilterSearch) {
        areaFilterSearch.value = "";
        filterAreaCheckboxes();
    }

    applyFilters();
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    loadJournals();
});
