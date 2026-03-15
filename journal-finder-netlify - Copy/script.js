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

    // Deduplicate by journal name (case-insensitive)
    function dedupe(list) {
        const seen = new Set();
        return list.filter(j => {
            const key = (j["Journal Name"] || "").toLowerCase().trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
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
        journals = cachedData;
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
            }            if (type === "aim") {
                const stopWordsText = 'about academic accept access account across act action active activity add advance affect after again against aim all allow also although always among amount analysis analyze and another any appear apply approach appropriately are area argue around article as assess associate at attempt author available background base be because become been before begin behavior behind being believe below benefit between beyond both brief bring broad building built but by call can cannot capture care case category cause central certain change chapter character characteristic choose claim class clear clearly close collect come common compare complete complex component comprehensive comprise concept concern conclude conclusion condition conduct confirm connect consider consist consistent construct contain context continue contribute contribution control core cost could course create critical critically crucial current currently data date day deal debate decide decision deep define degree demand demonstrate depend describe description design detail determine develop development did difference different difficult direct direction directly disciplines discuss discussion do document does doing done down draw due during each early ease easier easy edit edition editor editorial effect effective effectively effort either element emerge emphasize employ enable end engage ensure entire environment especially establish estimate evaluate evaluation even event ever every evidence exact exactly examine example excellent except exist existing expand expect experience experiment explain explore express extend extent external extract extreme face facilitate fact factor fail fall familiar fault favor feature feel few field figure find finding first fit focus follow following for form format former forth forward found foundation frame framework frequent from front full fully function fundamental further future gain gather general generally generate get give given global go good govern grant great group grow growth guide guideline had hand happen hard has have having he head health help her here high higher highest highly him his history hold hope how however i idea identify if illustrate image impact implement implementation imply importance important impose improve improvement in include including income incorporate increase increasingly indeed indicate individual industry influence information initial initially innovation input inquire inquiry insight instance instead institute institution instruction integrate interest interesting internal international interpret interpretation into introduce introduction investigate investigation involve is issue it item its itself job join journal judge judgment just keep key kind know knowledge known label lack language large last late later latter law lead leader leadership leading learn least leave less lesson let letter life light like likely limit limitation limited line link list literature little local locate locate long look loss low lower main mainly maintain major majority make making manage management many map market match material matter may maybe mean meaning measure measurement mechanism meet member memory mention merely message method methodology mid might mind mine minor minute miss missing mission model modern modify monitor more moreover most mostly move movement much multiple must my name national nature near nearly necessary need negative neither network never nevertheless new next no non none nor normal normally not note nothing notice notion novel now number numerous object objective observation observe obtain obvious obviously occur of off offer office often old on once one ongoing only onto open operate operation opinion opportunity oppose opposite optimism optimize or order organization organize origin original other others otherwise ought our out outcome output outside over overall own page panel paper parameter part partial participant participate particular particularly partly party pass past path pattern pay people per percent percentage perform performance perhaps period permission person personal perspective phase phenomenon piece place plan play please point policy poor population portion position positive possible possibly post potential potentially power powerful practical practice pragmatic precede precise precisely predict prediction prefer preference prepare presence present presentation preserve pressure prevent previous previously price primary primarily principal principle prior priority private probably problem procedure proceed process processing produce product production profession professional profile profit program progress project promise promote proof proper properly property proportion proposal propose protect protection prove provide public publication publish publisher purpose pursue push put quality quantify quantitative quarter question quick quickly quite quote raise range rapid rapidly rare rarely rate rather ratio raw reach react reaction read reader ready real realistic reality realize really reason reasonable receive recent recently recognize recommend recommendation record recover reduce reduction refer reference reflect reflection reform regard regarding regardless region regional register regular regulate regulation reinforce reject relate relation relationship relative relatively release relevant reliability reliable rely remain remark remarkable remember remind remove repeat replace reply report represent representation representative require requirement research researcher resolve resource respect respond response responsibility responsible rest result retain return reveal review reviewer revise revision rich right rise risk role room root round routine rule run safe safety same sample satisfaction satisfy save say scale scenario schedule scheme scholar scholarly school science scientific scientist scope score screen search season second secondary secret section sector secure security see seek seem select selection self sell send sense sensitive sensitivity separate sequence series serious seriously serve service session set setting settle several severe shape share she shift short shortly should show side sign signal significance significant significantly similar similarity simply simulate simulation since single site situation size skill slow slowly small so social society soft software solution solve some somebody somehow someone something sometimes somewhat somewhere soon sort sound source space speak speaker special specialist specific specifically specify speed spend split spread staff stage stand standard start state statement statistic statistical status stay step still stop storage store story straight strategy strength strengthen strict strictly strike strong strongly structural structure student study stuff style subject submit subsequent subsequently substance substantial substantially substitute succeed success successful successfully such sudden suddenly suffer sufficient sufficiently suggest suggestion sum summarize summary supply support suppose sure surely surface surprise surprising surprisingly system systematic systematically table tackle take talk target task teach teacher team technical technique technology tell term test text than thank that the their them themselves then theory theoretical there thereby therefore these they thing think thinking third this thorough thoroughly those though thought three through throughout thus time title to today together too tool top topic total totally touch toward towards track traditional train training transform transformation transition translate translation treat treatment trend trial true truly trust truth try turn two type typical typically ultimate ultimately unable uncover under undergo understand understanding undertake undoubted undoubtedly unequal unexpected unfortunately uniform unique unit universal university unless unlike unlikely until unusual up upon upper use useful user usual usually utility utilize valid validate validation validity valuable value variable variation various vary vast version versus very via view visible vision visit visual volume wait want way we weak weakness wealth weight well what whatever when whenever where whereas wherever whether which while who whole whom whose why wide widely will willing win window with within without work world worry worth would write writer writing wrong yeah year yes yet you young your yourself';
                const stopWords = new Set(stopWordsText.split(' '));
                const terms = input.split(/[^a-z0-9]+/).filter(w => w.length > 4 && !stopWords.has(w));
                if (terms.length === 0) return false;
                
                // Lazy initialize Global IDFs array so we weight rare words correctly
                if (!window.globalIdfs) {
                    window.globalIdfs = {};
                    // Assuming 'journals' is the global array of all journals
                    const allJournals = journals; 
                    allJournals.forEach(journal => {
                        const scopeWords = new Set(safeStr(journal['Aim & Scope']).toLowerCase().split(/[^a-z0-9]+/));
                        scopeWords.forEach(w => {
                            if (w.length > 4) window.globalIdfs[w] = (window.globalIdfs[w] || 0) + 1;
                        });
                    });
                }
                
                // Compute TF-IDF weights for the query terms
                const weights = {};
                let maxPossibleScore = 0;
                const allJournals = journals; // Ensure allJournals is defined for IDF calculation
                terms.forEach(t => {
                    let documentFrequency = window.globalIdfs[t] || 1;
                    // idf calculation (ln(N/df))
                    let weight = Math.log(allJournals.length / documentFrequency);
                    weights[t] = weight;
                    maxPossibleScore += weight;
                });
                
                const scope = safeStr(j["Aim & Scope"]).toLowerCase();
                const scopeWords = new Set(scope.split(/[^a-z0-9]+/));
                
                let score = 0;
                let matchCount = 0;
                
                for (let i = 0; i < terms.length; i++) {
                    const term = terms[i];
                    if (scopeWords.has(term)) {
                        score += weights[term];
                        matchCount++;
                    }
                }

                // Strictly enforce finding at least an incredible relevance to return anything.
                // Required score scales with paragraph size, up to a harsh cap.
                // We ask for ~20% of max theoretical score, or at least 2 highly unique words.
                const minScore = Math.min(15.0, maxPossibleScore * 0.15);
                
                if (matchCount >= 2 && score >= minScore) {
                    j.__matchScore = score;
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
function renderResults(data) {
    const box = document.getElementById("results");

    if (!data || data.length === 0) {
        box.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b;">No journals found matching criteria.</div>`;
        document.getElementById("resultCount").innerText = `Found 0 journals`;
        return;
    }

    document.getElementById("resultCount").innerText = `Found ${data.length} journals`;

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

    const html = data.slice(0, 50).map(j => {
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
