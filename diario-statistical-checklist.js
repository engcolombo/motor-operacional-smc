/* Checklist Estatístico pré-trade WIN$ (raw12 · 2021-2026 · 1.245 pregões · S30_V7 no toque). Independente de login. */
const StatChecklist = (() => {
    const STORAGE_KEY = "diarioStatChecklist_v1";

    const SAMPLE_META = {
        dataset: "raw12 · WIN$ · 2021–2026",
        sessions: "1.245 pregões (288 Treino 21–22 + 957 OOS 23–26)",
        engine: "S30_V7 no toque · 1 posição simultânea · 100% determinístico (sem ML)"
    };

    const RULES = [
        {
            id: "midpoint",
            requiredForF9: true,
            title: "1. Modo de entrada: Somente Midpoint (>200 pts, ordem no 50% / alvo 3R)",
            detail: "Confirmation (80–200 pts a mercado) perdeu R$ 13.790,65 com PF 0,793; OB Retest teve 0/6 (PF 0,000). Filtrar para Midpoint é o maior salto isolado (+10 pts de PF: 0,793 → 0,891).",
            tag: "Obrigatório",
            tagTone: "required"
        },
        {
            id: "context_origin",
            requiredForF9: true,
            title: "2. Origem forte: Contexto C (50% OB H1) OU Captura A fresca (≤ 20 barras M5 = ≤ 100 min)",
            detail: "Contexto C é o único positivo isolado em 5 anos (121 trades · WR 33,9% · +R$ 374,80 · PF 1,053 · OOS 1,081). Captura A fresca tem PF 0,879 (OOS 0,899) vs 0,793 (OOS 0,760) após 100 min.",
            tag: "Obrigatório",
            tagTone: "required"
        },
        {
            id: "no_weak_solo",
            requiredForF9: true,
            title: "3. Sem gatilho fraco isolado: NÃO entrar só por D (AVWAP M5) nem por B (50% OB M15)",
            detail: "Contexto D exclusivo (710 trades): PF 0,849 (-R$ 6.498,80). Contexto B (106 trades): pior contexto isolado, PF 0,755 (-R$ 1.617,55). Use AVWAP M5 apenas em confluência com C ou A fresca.",
            tag: "Obrigatório",
            tagTone: "required"
        },
        {
            id: "no_opp_avwap",
            requiredForF9: true,
            title: "4. Caminho livre de AVWAP M5 oposta antes do alvo",
            detail: "Midpoint COM AVWAP oposta no caminho despenca para PF 0,816 (440 trades · -R$ 5.106,40 · -0,144R). Sem AVWAP oposta (F6), o Midpoint sobe para PF 0,915 (OOS 0,894).",
            tag: "Veto duro",
            tagTone: "veto"
        },
        {
            id: "no_opp_ob_swing",
            requiredForF9: false,
            title: "5. Caminho livre de OB Swing oposto (M10 / M15 / H1) antes do alvo",
            detail: "Midpoint batendo em OB Swing oposto cai para WR 22,8%, PF 0,774 e -0,217R (145 trades · -R$ 2.015,80). Evitar essa parede institucional eleva o F9 para PF 1,044 (+R$ 1.339,20). OB Internal pequeno não trava.",
            tag: "Veto parede",
            tagTone: "veto"
        }
    ];

    const KPI_CARDS = [
        {
            label: "Baseline S30_V7 (F0 sem filtro)",
            value: "-R$ 24.538,90",
            meta: "PF 0,852 · 2.737 trades · WR 28,2% · E[R] -0,112R",
            tone: "neg"
        },
        {
            label: "F9 Determinístico (4 travas base)",
            value: "+R$ 1.311,70",
            meta: "PF 1,040 · 552 trades · TR 1,083 / OOS 1,024 · +0,033R",
            tone: "pos"
        },
        {
            label: "F9+ Limpo (5 travas · Campeão Manual)",
            value: "+R$ 1.339,20",
            meta: "PF 1,044 · 520 trades · TR 1,103 / OOS 1,021 · +0,038R",
            tone: "pos"
        },
        {
            label: "Melhor Contexto Isolado (C · OB H1)",
            value: "+R$ 374,80",
            meta: "PF 1,053 · 121 trades · WR 33,9% · OOS 1,081 (+R$ 444,70)",
            tone: "pos"
        }
    ];

    const CONTEXT_RANKING = [
        { name: "1. Contexto C (50% OB H1)", stats: "PF 1,053 · WR 33,9% · +R$ 374,80 · OOS 1,081", verdict: "Prioridade máxima (único + sozinho)", tone: "approved" },
        { name: "2. F9+ Limpo (5 travas manuais)", stats: "PF 1,044 · WR 29,2% · +R$ 1.339,20 · TR 1,103 / OOS 1,021", verdict: "Checklist campeão sem ML", tone: "approved" },
        { name: "3. Captura A fresca (≤ 20 M5 / ≤ 100 min)", stats: "PF 0,879 · OOS 0,899 · 1.308 trades", verdict: "Boa matéria-prima p/ F9+", tone: "base" },
        { name: "4. Contexto D ativo em confluência (AVWAP M5)", stats: "PF 0,872 · OOS 0,883 · 1.096 trades", verdict: "Usar apenas como reforço", tone: "base" },
        { name: "5. Contexto D exclusivo (só AVWAP M5)", stats: "PF 0,849 · -R$ 6.498,80 · 710 trades", verdict: "Cortar entrada isolada", tone: "avoid" },
        { name: "6. Captura A velha (> 20 M5 / > 100 min)", stats: "PF 0,793 · OOS 0,760 · -R$ 9.844,35", verdict: "Cortar capturas atrasadas", tone: "avoid" },
        { name: "7. Confirmation (80–200 pts a mercado)", stats: "PF 0,793 · WR 32,1% · -R$ 13.790,65", verdict: "Maior ralo financeiro", tone: "avoid" },
        { name: "8. Midpoint vs OB Swing oposto (M10/M15/H1)", stats: "PF 0,774 · WR 22,8% · -0,217R · -R$ 2.015,80", verdict: "Parede institucional — Vetar", tone: "avoid" },
        { name: "9. Contexto B (50% OB M15)", stats: "PF 0,755 · WR 28,3% · -R$ 1.617,55", verdict: "Pior contexto isolado", tone: "avoid" },
        { name: "10. OB Retest (fallback)", stats: "PF 0,000 · WR 0,0% (0/6) · -R$ 413,85", verdict: "Desativar completamente", tone: "avoid" }
    ];

    const MYTHS = [
        {
            title: "Mito 1: \"Não entrar quando há contexto oposto ativo\"",
            summary: "Na amostra Midpoint, operar COM contexto oposto ativo (1.267 trades · PF 0,916 · OOS 0,931) foi melhor do que operar SEM contexto oposto ativo (444 trades · PF 0,818 · OOS 0,779).",
            guidance: "Motivo: reversões boas do WIN$ quase sempre nascem perto de uma zona oposta recente. O veto verdadeiro é específico: barreira de AVWAP M5 oposta (PF 0,816) ou OB Swing M10/M15/H1 oposto no caminho do alvo (PF 0,774)."
        },
        {
            title: "Mito 2: \"Exigir Estrutura Swing MTF ou Premium/Discount > 0 como trava dura\"",
            summary: "Filtrar o F9 positivo (+R$ 1.311,70 · PF 1,040) por Estrutura Swing MTF >= 0 derrubou para 319 trades / PF 0,887 (-R$ 2.210,30). Filtrar por Premium/Discount MTF > 0 derrubou para 260 trades / PF 0,945 (-R$ 877,75).",
            guidance: "Motivo: POIs pós-captura de liquidez (A) e de toque em OB H1 (C) capturam a virada antes do swing do tempo maior romper a favor. Use macro/MTF só como leitura qualitativa de alvo, não como trava binária."
        }
    ];

    const TABLE_ROWS = [
        { id: "f0", category: "base", label: "F0_base (Tudo sem filtro)", trades: "2.737", wr: "28,2%", pnl5y: "-R$ 24.538,90", pf5y: "0,852", tr: "0,860 (-R$ 5.058,20)", oos: "0,850 (-R$ 19.480,70)", expR: "-0,112R", verdict: "Referência base" },
        { id: "confirmation", category: "avoid", label: "Somente Confirmation (80–200 pts a mercado)", trades: "1.125", wr: "32,1%", pnl5y: "-R$ 13.790,65", pf5y: "0,793", tr: "0,776 (-R$ 1.510,15)", oos: "0,795 (-R$ 12.280,50)", expR: "-0,145R", verdict: "Evitar · Maior ralo" },
        { id: "midpoint_exact", category: "base", label: "Somente Midpoint (>200 pts · flag exata)", trades: "1.692", wr: "25,7%", pnl5y: "-R$ 11.350,00", pf5y: "0,891", tr: "0,882 (-R$ 3.502,70)", oos: "0,894 (-R$ 7.847,30)", expR: "-0,090R", verdict: "Base · +10 pts PF" },
        { id: "ob_retest", category: "avoid", label: "Somente OB Retest (fallback)", trades: "6", wr: "0,0%", pnl5y: "-R$ 413,85", pf5y: "0,000", tr: "0,000 (-R$ 303,75)", oos: "0,000 (-R$ 110,10)", expR: "-1,088R", verdict: "Cortar · 0/6 acerto" },
        { id: "ctx_a_all", category: "base", label: "Contexto A ativo (todos modos)", trades: "2.016", wr: "28,3%", pnl5y: "-R$ 17.957,95", pf5y: "0,853", tr: "0,862 (-R$ 3.502,85)", oos: "0,850 (-R$ 14.455,10)", expR: "-0,112R", verdict: "Base · Filtrar idade" },
        { id: "ctx_b", category: "avoid", label: "Contexto B (50% OB M15)", trades: "106", wr: "28,3%", pnl5y: "-R$ 1.617,55", pf5y: "0,755", tr: "0,762 (-R$ 436,15)", oos: "0,752 (-R$ 1.181,40)", expR: "-0,169R", verdict: "Evitar · Pior contexto" },
        { id: "ctx_c", category: "approved", label: "Contexto C (50% OB H1)", trades: "121", wr: "33,9%", pnl5y: "+R$ 374,80", pf5y: "1,053", tr: "0,955 (-R$ 69,90)", oos: "1,081 (+R$ 444,70)", expR: "+0,059R", verdict: "Aprovado · Único + solo" },
        { id: "ctx_d_all", category: "base", label: "Contexto D ativo (AVWAP M5 geral)", trades: "1.096", wr: "28,0%", pnl5y: "-R$ 8.404,80", pf5y: "0,872", tr: "0,834 (-R$ 2.416,55)", oos: "0,883 (-R$ 5.988,25)", expR: "-0,106R", verdict: "Base · Só confluência" },
        { id: "ctx_d_only", category: "avoid", label: "Contexto D EXCLUSIVO (só AVWAP M5, sem A/B/C)", trades: "710", wr: "27,7%", pnl5y: "-R$ 6.498,80", pf5y: "0,849", tr: "0,847 (-R$ 1.539,40)", oos: "0,850 (-R$ 4.959,40)", expR: "-0,115R", verdict: "Evitar · Não entrar só D" },
        { id: "a_fresh", category: "base", label: "Captura A fresca (≤ 20 M5 = ≤ 100 min)", trades: "1.308", wr: "28,8%", pnl5y: "-R$ 9.559,25", pf5y: "0,879", tr: "0,807 (-R$ 3.401,70)", oos: "0,899 (-R$ 6.157,55)", expR: "-0,091R", verdict: "Base · Preferir novas" },
        { id: "a_old", category: "avoid", label: "Captura A velha (> 20 M5 = > 100 min)", trades: "777", wr: "27,0%", pnl5y: "-R$ 9.844,35", pf5y: "0,793", tr: "0,944 (-R$ 488,20)", oos: "0,760 (-R$ 9.356,15)", expR: "-0,162R", verdict: "Cortar atrasadas" },
        { id: "f4", category: "base", label: "F4: Midpoint / Limit apenas (sem Confirmation)", trades: "1.698", wr: "25,6%", pnl5y: "-R$ 11.763,85", pf5y: "0,887", tr: "0,874 (-R$ 3.806,45)", oos: "0,893 (-R$ 7.957,40)", expR: "-0,093R", verdict: "Base · Entrada limite" },
        { id: "mid_with_avwap", category: "avoid", label: "Midpoint COM AVWAP oposta antes do alvo", trades: "440", wr: "24,3%", pnl5y: "-R$ 5.106,40", pf5y: "0,816", tr: "0,637 (-R$ 3.213,40)", oos: "0,899 (-R$ 1.893,00)", expR: "-0,144R", verdict: "Vetar · Barreira AVWAP" },
        { id: "f6", category: "base", label: "F6: Midpoint + SEM AVWAP oposta", trades: "1.281", wr: "26,1%", pnl5y: "-R$ 6.631,65", pf5y: "0,915", tr: "0,971 (-R$ 633,55)", oos: "0,894 (-R$ 5.998,10)", expR: "-0,075R", verdict: "Base · Limpo AVWAP" },
        { id: "f7", category: "base", label: "F7: Sem D-only + Captura A ≤ 100 min (todos)", trades: "1.379", wr: "29,0%", pnl5y: "-R$ 9.874,55", pf5y: "0,881", tr: "0,820 (-R$ 3.380,65)", oos: "0,899 (-R$ 6.493,90)", expR: "-0,088R", verdict: "Base · Sem Midpoint" },
        { id: "f8", category: "base", label: "F8: Midpoint + Sem D-only + Captura A ≤ 100 min", trades: "813", wr: "27,1%", pnl5y: "-R$ 3.108,80", pf5y: "0,937", tr: "0,832 (-R$ 2.534,80)", oos: "0,983 (-R$ 574,00)", expR: "-0,045R", verdict: "Base · Falta veto AVWAP" },
        { id: "f9", category: "approved", label: "F9: Midpoint + Sem AVWAP + Sem D-only + A ≤ 100m", trades: "552", wr: "29,0%", pnl5y: "+R$ 1.311,70", pf5y: "1,040", tr: "1,083 (+R$ 732,45)", oos: "1,024 (+R$ 579,25)", expR: "+0,033R", verdict: "Aprovado · + 21-22 e 23-26" },
        { id: "mid_with_ob_sw", category: "avoid", label: "Midpoint COM OB Swing oposto (M10/M15/H1) no alvo", trades: "145", wr: "22,8%", pnl5y: "-R$ 2.015,80", pf5y: "0,774", tr: "0,736 (-R$ 454,85)", oos: "0,784 (-R$ 1.560,95)", expR: "-0,217R", verdict: "Vetar · Parede Swing OB" },
        { id: "mid_no_ob_sw", category: "base", label: "Midpoint SEM OB Swing oposto no caminho do alvo", trades: "1.557", wr: "25,9%", pnl5y: "-R$ 9.713,55", pf5y: "0,898", tr: "0,882 (-R$ 3.351,60)", oos: "0,905 (-R$ 6.361,95)", expR: "-0,082R", verdict: "Base · Caminho sem OB" },
        { id: "myth_with_opp_ctx", category: "myth", label: "Midpoint COM contexto oposto ativo (opp_ctx)", trades: "1.267", wr: "26,0%", pnl5y: "-R$ 6.507,35", pf5y: "0,916", tr: "0,876 (-R$ 2.693,20)", oos: "0,931 (-R$ 3.814,15)", expR: "-0,073R", verdict: "Mito · Melhor que sem" },
        { id: "myth_no_opp_ctx", category: "myth", label: "Midpoint SEM contexto oposto ativo (opp_ctx = 0)", trades: "444", wr: "24,8%", pnl5y: "-R$ 5.058,95", pf5y: "0,818", tr: "0,905 (-R$ 821,40)", oos: "0,779 (-R$ 4.237,55)", expR: "-0,144R", verdict: "Mito · Vetar opp_ctx piora" },
        { id: "f9_clean", category: "approved", label: "F9 + SEM OB Swing oposto no caminho (F9+ Limpo)", trades: "520", wr: "29,2%", pnl5y: "+R$ 1.339,20", pf5y: "1,044", tr: "1,103 (+R$ 874,15)", oos: "1,021 (+R$ 465,05)", expR: "+0,038R", verdict: "Campeão Manual · 5/5 travas" },
        { id: "myth_pd_mtf", category: "myth", label: "F9 + Premium/Discount MTF a favor (> 0)", trades: "260", wr: "26,9%", pnl5y: "-R$ 877,75", pf5y: "0,945", tr: "1,086 (+R$ 436,75)", oos: "0,879 (-R$ 1.314,50)", expR: "-0,045R", verdict: "Mito · Derruba OOS F9" },
        { id: "myth_swing_mtf", category: "myth", label: "F9 + Estrutura Swing MTF a favor (>= 0)", trades: "319", wr: "26,0%", pnl5y: "-R$ 2.210,30", pf5y: "0,887", tr: "0,838 (-R$ 762,50)", oos: "0,903 (-R$ 1.447,80)", expR: "-0,089R", verdict: "Mito · Derruba o F9" }
    ];

    const FILTER_LABELS = {
        all: "Todos",
        approved: "Aprovados",
        avoid: "Evitar / Vetos",
        myth: "Mitos",
        base: "Base / Contextos"
    };

    const ML_REFERENCE = [
        {
            badge: "Finalista #1 · PASS 8/8",
            tone: "approved",
            title: "S30_V7_decision :: F6_midpoint_no_opp_avwap :: TCN_POI_v2 (50%)",
            metrics: "OOS 2023–2026 (957 pregões): 500 trades (0,522/d) · WR 30,0% · +R$ 2.871,55 · PF 1,098 · +0,070R · DD R$ 2.553,00 · Estresse +1/+2 = +R$ 1.973,55 / +R$ 1.075,55 · AUC 0,5360 (mediana folds 0,5463) · 8/8 semestres batendo F6 (5/8 pos.) · Boot vs F6 +R$ 9,27/trade (IC95% [+4,53; +13,80], p = 1,000)."
        },
        {
            badge: "Finalista #2 · Desafiante (c/ ressalvas)",
            tone: "caution",
            title: "S30_V7_decision :: F8_midpoint_no_d_short_a20 :: TCNreg × GRU3C_Bar_Favor (65%×75%)",
            metrics: "OOS 2023–2026: 275 trades (0,287/d) · WR 31,3% · +R$ 2.127,25 · PF 1,137 · +0,121R · DD R$ 1.690,30 · Estresse +1/+2 = +R$ 1.645,25 / +R$ 1.163,25 · 6/8 semestres positivos. Ressalvas: frequência 0,287/d < 0,33/d e Boot IC95% [-1,60; +7,30]."
        },
        {
            badge: "Por que o TCN teve AUC < 0,50 em F8?",
            tone: "neutral",
            title: "Interpretação técnica p/ execução manual sem ML",
            metrics: "No recorte F8 (sem D-only e sem A > 100 min, porém com AVWAP oposta ainda solta), o subconjunto restante responde mais ao contexto macro MTF (GRU) e às barreiras do caminho do que à microestrutura M1 do toque. Na subamostra F6 limpa de AVWAP oposta, o mesmo TCN_POI_v2 sobe para AUC 0,5360 (folds 0,5463). Para operar manualmente sem ML, aplique integralmente as 5 travas do F9+ Limpo."
        }
    ];

    let checks = loadChecks();
    let activeFilter = "all";
    let bound = false;

    function esc(value) {
        if (typeof escapeHtml === "function") return escapeHtml(value == null ? "" : String(value));
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function emptyChecks() {
        const out = {};
        RULES.forEach((rule) => { out[rule.id] = false; });
        return out;
    }

    function normalizeChecks(raw) {
        const out = emptyChecks();
        if (!raw || typeof raw !== "object") return out;
        RULES.forEach((rule) => { out[rule.id] = Boolean(raw[rule.id]); });
        return out;
    }

    function loadChecks() {
        if (typeof localStorage === "undefined") return emptyChecks();
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? normalizeChecks(JSON.parse(raw)) : emptyChecks();
        } catch (e) {
            return emptyChecks();
        }
    }

    function persistChecks() {
        if (typeof localStorage === "undefined") return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(checks));
        } catch (e) {}
    }

    function getVerdict(map = checks) {
        const checkedCount = RULES.reduce((acc, r) => acc + (map[r.id] ? 1 : 0), 0);
        const baseF9Ready = RULES.filter((r) => r.requiredForF9).every((r) => Boolean(map[r.id]));
        const allReady = checkedCount === RULES.length;

        if (allReady) {
            return {
                level: "approved",
                checkedCount,
                total: RULES.length,
                badge: "AUTORIZADO · F9+ Limpo",
                headline: "5/5 travas confirmadas — Setup F9+ Limpo autorizado",
                detail: "Referência auditada (raw12 · 5 anos sem ML): 520 trades · WR 29,2% · PF 1,044 · +R$ 1.339,20 · +0,038R · Positivo em 2021–2022 (PF 1,103) e 2023–2026 (PF 1,021)."
            };
        }
        if (baseF9Ready) {
            return {
                level: "caution",
                checkedCount,
                total: RULES.length,
                badge: "F9 BASE · Conferir OB Oposto",
                headline: "4/5 travas — F9 Base ativo (falta checar OB Swing oposto M10/M15/H1)",
                detail: "F9 sem filtro de OB oposto já é positivo nos 2 períodos (552 trades · WR 29,0% · PF 1,040 · +R$ 1.311,70), mas bater em OB Swing oposto derruba WR para 22,8% (PF 0,774). Confirme se o caminho até o alvo está livre."
            };
        }
        const missing = RULES.filter((r) => r.requiredForF9 && !map[r.id]).map((r) => r.title.replace(/^\d+\.\s*/, ""));
        return {
            level: "blocked",
            checkedCount,
            total: RULES.length,
            badge: "AGUARDAR / VETADO",
            headline: `${checkedCount}/${RULES.length} travas — Não operar ainda`,
            detail: `Falta confirmar: ${missing.join("; ")}. Operar fora do F9/F9+ devolve o edge ao baseline negativo (S30_V7 F0: PF 0,852 · -R$ 24.538,90).`
        };
    }

    function filteredRows(filterKey = activeFilter) {
        if (filterKey === "all") return TABLE_ROWS.slice();
        return TABLE_ROWS.filter((row) => row.category === filterKey);
    }

    function categoryCounts() {
        const counts = { all: TABLE_ROWS.length, approved: 0, avoid: 0, myth: 0, base: 0 };
        TABLE_ROWS.forEach((row) => {
            if (Object.prototype.hasOwnProperty.call(counts, row.category)) counts[row.category] += 1;
        });
        return counts;
    }

    function pnlTone(val) {
        if (String(val).startsWith("+")) return "color:var(--green);font-weight:700;";
        if (String(val).startsWith("-")) return "color:var(--red);";
        return "";
    }

    function renderHtml() {
        const verdict = getVerdict(checks);
        const rows = filteredRows(activeFilter);
        const counts = categoryCounts();

        const kpiHtml = KPI_CARDS.map((card) => `
            <div class="kpi-card ${esc(card.tone)}">
                <div class="label">${esc(card.label)}</div>
                <div class="value">${esc(card.value)}</div>
                <div class="meta">${esc(card.meta)}</div>
            </div>
        `).join("");

        const rulesHtml = RULES.map((rule) => {
            const isChecked = Boolean(checks[rule.id]);
            return `
                <label class="stat-rule-item ${isChecked ? "is-checked" : ""}" for="stat-rule-${esc(rule.id)}">
                    <input type="checkbox" id="stat-rule-${esc(rule.id)}" data-stat-rule="${esc(rule.id)}" ${isChecked ? "checked" : ""}>
                    <div class="stat-rule-body">
                        <div class="stat-rule-head">
                            <strong>${esc(rule.title)}</strong>
                            <span class="stat-rule-tag is-${esc(rule.tagTone)}">${esc(rule.tag)}</span>
                        </div>
                        <p>${esc(rule.detail)}</p>
                    </div>
                </label>
            `;
        }).join("");

        const rankHtml = CONTEXT_RANKING.map((item) => `
            <div class="stat-rank-row">
                <div class="stat-rank-main">
                    <strong>${esc(item.name)}</strong>
                    <span>${esc(item.stats)}</span>
                </div>
                <span class="stat-badge is-${esc(item.tone)}">${esc(item.verdict)}</span>
            </div>
        `).join("");

        const mythsHtml = MYTHS.map((myth) => `
            <div class="stat-myth-card">
                <h3>${esc(myth.title)}</h3>
                <p class="stat-myth-summary">${esc(myth.summary)}</p>
                <p class="stat-myth-guidance">${esc(myth.guidance)}</p>
            </div>
        `).join("");

        const filterButtonsHtml = Object.keys(FILTER_LABELS).map((key) => {
            const selected = activeFilter === key;
            return `<button type="button" class="btn ${selected ? "active" : ""}" data-stat-filter="${esc(key)}" aria-pressed="${selected ? "true" : "false"}">${esc(FILTER_LABELS[key])} (${counts[key]})</button>`;
        }).join("");

        const tableBodyHtml = rows.map((row) => `
            <tr>
                <td><strong>${esc(row.label)}</strong></td>
                <td class="right">${esc(row.trades)}</td>
                <td class="right">${esc(row.wr)}</td>
                <td class="right" style="${pnlTone(row.pnl5y)}">${esc(row.pnl5y)}</td>
                <td class="right"><strong>${esc(row.pf5y)}</strong></td>
                <td class="right">${esc(row.tr)}</td>
                <td class="right">${esc(row.oos)}</td>
                <td class="right" style="${pnlTone(row.expR)}">${esc(row.expR)}</td>
                <td><span class="stat-badge is-${esc(row.category)}">${esc(row.verdict)}</span></td>
            </tr>
        `).join("");

        const mlHtml = ML_REFERENCE.map((item) => `
            <div class="stat-ml-card">
                <span class="stat-badge is-${esc(item.tone)}">${esc(item.badge)}</span>
                <h3>${esc(item.title)}</h3>
                <p>${esc(item.metrics)}</p>
            </div>
        `).join("");

        return `
            <div class="stat-banner">
                <div>
                    <span class="stat-banner-pill">Acesso livre · antes do login</span>
                    <strong>Referência Auditada WIN$ — Execução Manual no Toque (sem ML)</strong>
                    <p>${esc(SAMPLE_META.dataset)} · ${esc(SAMPLE_META.sessions)} · ${esc(SAMPLE_META.engine)}. Checklist salvo localmente neste navegador sem depender de sessão Supabase.</p>
                </div>
            </div>

            <div class="kpi-grid stat-kpi-grid">${kpiHtml}</div>

            <div class="panel stat-checklist-panel">
                <div class="panel-head">
                    <div>
                        <h2>Checklist Pré-Trade Interativo (Regra F9+ Limpo)</h2>
                        <p>Marque as 5 travas antes de posicionar a ordem limite no Midpoint (>200 pts)</p>
                    </div>
                    <button type="button" class="btn btn-ghost" id="btnStatChecklistReset">Limpar checklist (novo trade)</button>
                </div>
                <div class="panel-body">
                    <div class="stat-verdict is-${esc(verdict.level)}" id="statChecklistVerdict" role="status" aria-live="polite">
                        <div class="stat-verdict-top">
                            <span class="stat-verdict-badge">${esc(verdict.badge)}</span>
                            <span class="stat-verdict-count">${verdict.checkedCount}/${verdict.total} travas</span>
                        </div>
                        <strong>${esc(verdict.headline)}</strong>
                        <p>${esc(verdict.detail)}</p>
                    </div>
                    <div class="stat-rule-list">${rulesHtml}</div>
                </div>
            </div>

            <div class="stat-two-col">
                <div class="panel">
                    <div class="panel-head">
                        <div>
                            <h2>Hierarquia de Contextos e Entradas</h2>
                            <p>Do melhor retorno estrutural (Contexto C · OB H1) ao pior (OB Retest / Contexto B)</p>
                        </div>
                    </div>
                    <div class="panel-body">
                        <div class="stat-rank-list">${rankHtml}</div>
                    </div>
                </div>

                <div class="panel">
                    <div class="panel-head">
                        <div>
                            <h2>2 Mitos Derrubados pelos Dados</h2>
                            <p>Filtros que parecem intuitivos, mas pioram o F9 quando viram regra rígida</p>
                        </div>
                    </div>
                    <div class="panel-body">
                        <div class="stat-myths-wrap">${mythsHtml}</div>
                    </div>
                </div>
            </div>

            <div class="panel stat-table-panel">
                <div class="panel-head stat-table-head">
                    <div>
                        <h2>Tabela Estatística Completa Auditada (${TABLE_ROWS.length} recortes no raw12)</h2>
                        <p>Simulação 1-posição no toque (S30_V7) separada entre Treino (2021–2022) e OOS (2023–2026)</p>
                    </div>
                    <div class="stat-filter-bar" role="group" aria-label="Filtrar recortes estatísticos">${filterButtonsHtml}</div>
                </div>
                <div class="table-scroll stat-table-scroll" tabindex="0" role="region" aria-label="Tabela estatística determinística do WIN$">
                    <table>
                        <thead>
                            <tr>
                                <th>Regra / Contexto Determinístico</th>
                                <th class="right">Trades (5a)</th>
                                <th class="right">WR</th>
                                <th class="right">PnL Líq. (5a)</th>
                                <th class="right">PF Total</th>
                                <th class="right">Treino 21–22 (PF / Líq.)</th>
                                <th class="right">OOS 23–26 (PF / Líq.)</th>
                                <th class="right">E[R]</th>
                                <th>Veredito</th>
                            </tr>
                        </thead>
                        <tbody id="statChecklistTableBody">${tableBodyHtml}</tbody>
                    </table>
                </div>
            </div>

            <div class="panel stat-ml-panel">
                <div class="panel-head">
                    <div>
                        <h2>Referência ML (Walk-Forward OOS 2023–2026 · TCN_POI_v2 e GRU MTF)</h2>
                        <p>Contexto dos modelos neurais testados no toque sem Resting Limit</p>
                    </div>
                </div>
                <div class="panel-body">
                    <div class="stat-ml-grid">${mlHtml}</div>
                </div>
            </div>
        `;
    }

    function render() {
        if (typeof document === "undefined") return false;
        const root = document.getElementById("statChecklistRoot");
        if (!root) return false;
        root.innerHTML = renderHtml();
        return true;
    }

    function toggleRule(ruleId, checked) {
        if (!RULES.some((r) => r.id === ruleId)) return false;
        checks[ruleId] = Boolean(checked);
        persistChecks();
        render();
        return true;
    }

    function resetChecks() {
        checks = emptyChecks();
        persistChecks();
        render();
        return checks;
    }

    function setFilter(filterKey) {
        if (!Object.prototype.hasOwnProperty.call(FILTER_LABELS, filterKey)) return false;
        activeFilter = filterKey;
        render();
        return true;
    }

    function handleRootChange(event) {
        const input = event?.target?.closest ? event.target.closest("[data-stat-rule]") : null;
        if (!input) return;
        toggleRule(input.dataset.statRule, input.checked);
    }

    function handleRootClick(event) {
        const target = event?.target;
        if (!target) return;
        const resetBtn = target.closest ? target.closest("#btnStatChecklistReset") : (target.id === "btnStatChecklistReset" ? target : null);
        if (resetBtn) {
            resetChecks();
            return;
        }
        const filterBtn = target.closest ? target.closest("[data-stat-filter]") : null;
        if (filterBtn && filterBtn.dataset?.statFilter) {
            setFilter(filterBtn.dataset.statFilter);
        }
    }

    function init() {
        if (typeof document !== "undefined" && !bound) {
            const root = document.getElementById("statChecklistRoot");
            if (root && typeof root.addEventListener === "function") {
                root.addEventListener("change", handleRootChange);
                root.addEventListener("click", handleRootClick);
                bound = true;
            }
        }
        render();
    }

    return {
        init,
        render,
        renderHtml,
        getVerdict,
        filteredRows,
        categoryCounts,
        toggleRule,
        resetChecks,
        setFilter,
        getState: () => ({
            checks: { ...checks },
            activeFilter,
            verdict: getVerdict(checks)
        }),
        RULES,
        TABLE_ROWS,
        SAMPLE_META
    };
})();
