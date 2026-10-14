import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Clock3, Cpu, Download, HardDrive,
  Radio, RefreshCw, ShieldCheck, TriangleAlert, Waves, Zap
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import type { RuntimeEvent, RuntimeFingerprint, SessionSummary } from "@runtime-radar/shared";

type ConnectionState = "connecting" | "live" | "offline";
type Language = "ru" | "kk";
type Copy = { [Key in keyof typeof translations.ru]: string };
type RegressionMetric = { current: number | null; baseline: number | null; changePercent: number | null };
type Regression = { currentSessionId: string; baselineSessionId: string; metrics: Record<string, RegressionMetric> };

const translations = {
  ru: {
    workspace: "РАБОЧАЯ ОБЛАСТЬ", overview: "Обзор", incidents: "Инциденты", httpTraffic: "HTTP-трафик",
    sessions: "Сессии", privateByDefault: "Конфиденциальность по умолчанию",
    dataOnMachine: "Данные остаются на этом устройстве", projects: "Проекты", application: "Приложение Node.js",
    liveMonitoring: "Мониторинг активен", connecting: "Подключение", waitingForAgent: "Ожидание агента",
    refreshDashboard: "Обновить панель", observability: "МОНИТОРИНГ NODE.JS", runtimeOverview: "Обзор среды выполнения",
    liveSignal: "Состояние приложения в реальном времени.", selectSession: "Выберите сессию",
    selectRuntimeSession: "Выберите сессию среды выполнения", exportReport: "Экспорт отчёта",
    currentMetrics: "Текущие показатели", cpuUsage: "ЗАГРУЗКА ЦП", oneCore: "от одного ядра",
    processCpu: "Процессор процесса", memoryRss: "ПАМЯТЬ RSS", residentSet: "Резидентная память",
    waitingMetrics: "Ожидание показателей", eventLoopLag: "ЗАДЕРЖКА ЦИКЛА СОБЫТИЙ",
    meanInterval: "среднее за интервал", aboveThreshold: "Выше порога 100 мс",
    expectedRange: "В пределах нормы", httpP95: "ЗАДЕРЖКА HTTP P95", requestsObserved: "запросов получено",
    serverErrors: "ошибок сервера", processHealth: "Состояние процесса", lastSamples: "Последние 60 измерений",
    live: "В ЭФИРЕ", waitingFirstSample: "Ожидание первого измерения",
    startAgent: "Запустите агент Node.js, чтобы увидеть показатели процесса.",
    cpuNormalized: "ЦП нормирован на одно логическое ядро; значение может превышать 100%.",
    updated: "Обновлено", noSamples: "Измерений пока нет", runtimeFingerprint: "Отпечаток среды выполнения", reproduceEnvironment: "Воспроизвести эту среду",
    appVersion: "ВЕРСИЯ ПРИЛОЖЕНИЯ", gitCommit: "КОММИТ GIT", nodeJs: "NODE.JS",
    platform: "ПЛАТФОРМА", process: "ПРОЦЕСС", fingerprintUnavailable: "Отпечаток среды недоступен",
    connectAgent: "Подключите агент, чтобы получить сведения о среде выполнения.",
    noSecrets: "Секреты среды не собираются.", incidentTimeline: "Хронология инцидентов",
    signalsAround: "События вокруг важных моментов", viewActivity: "Показать активность",
    quietSoFar: "Пока всё спокойно", incidentsWillAppear: "Здесь появятся ошибки, аномалии и ответы HTTP 5xx.",
    regressionWatch: "Контроль регрессий", compareBaseline: "Сравнение текущего запуска с эталонным",
    runDiff: "СРАВНЕНИЕ ЗАПУСКОВ", baselineSession: "ЭТАЛОННАЯ СЕССИЯ",
    choosePreviousRun: "Выберите предыдущий запуск", signalsTrendingUp: "Некоторые показатели растут",
    noRegressions: "Заметных регрессий не обнаружено", medianCurrentBaseline: "Медианы · текущий запуск и эталон",
    rssMemory: "Память RSS", httpLatency: "Задержка HTTP",
    chooseSessionCompare: "Выберите предыдущую сессию для сравнения ЦП, памяти и задержки.",
    sameHostComparison: "Сравнение на одном устройстве · медианные значения, не диагноз",
    liveActivity: "Активность в реальном времени",
    sanitizedActivity: "Очищенные логи, исключения и трассировки запросов",
    logsErrors: "Логи и ошибки", downloadJson: "Скачать отчёт JSON", time: "ВРЕМЯ", type: "ТИП",
    detail: "ПОДРОБНОСТИ", severity: "ВАЖНОСТЬ", source: "ИСТОЧНИК", noActivity: "Активности пока нет",
    activityWillAppear: "Здесь в реальном времени появятся логи, ошибки и HTTP-трафик.",
    recentHttpRequests: "Последние HTTP-запросы",
    routePatterns: "Сохраняются шаблоны маршрутов, а не исходные URL", captured: "получено",
    method: "МЕТОД", route: "МАРШРУТ", status: "СТАТУС", latency: "ЗАДЕРЖКА",
    noRequests: "Запросов пока нет", installMiddleware: "Добавьте httpMiddleware(agent) в HTTP-сервер Node.js.",
    recentSessions: "Недавние сессии", persistentHistory: "Локальная история сохраняется",
    sessionCount: "сессий", events: "событий",
    sessionsSaved: "Сессии среды выполнения будут автоматически сохраняться здесь.",
    localFirst: "Локальный мониторинг Node.js", dataRemains: "Данные хранятся на вашем устройстве",
    language: "Язык", error: "Ошибка", anomaly: "Аномалия", info: "Информация", warning: "Предупреждение",
    critical: "Критично", runtimeError: "Ошибка среды выполнения", httpResponse: "ответ HTTP",
    setupTitle: "Подключите первое приложение", setupCopy: "Запустите демонстрационный Node.js-сервис в новом окне PowerShell. Он отправит сюда метрики, запросы и тестовые события.",
    setupRunDemo: "1. Запустите демо из папки проекта", setupSendRequests: "2. Создайте тестовую активность",
    copyCommand: "Скопировать команду", commandCopied: "Скопировано",
    setupPrivacy: "Команда читает локальный токен Runtime Radar; секрет не нужно вставлять или публиковать.",
    clipboardUnavailable: "Не удалось скопировать команду. Скопируйте её вручную."
  },
  kk: {
    workspace: "ЖҰМЫС АЙМАҒЫ", overview: "Шолу", incidents: "Оқиғалар", httpTraffic: "HTTP трафигі",
    sessions: "Сессиялар", privateByDefault: "Әдепкі бойынша құпия",
    dataOnMachine: "Деректер осы құрылғыда сақталады", projects: "Жобалар", application: "Node.js қолданбасы",
    liveMonitoring: "Мониторинг белсенді", connecting: "Қосылуда", waitingForAgent: "Агент күтілуде",
    refreshDashboard: "Басқару тақтасын жаңарту", observability: "NODE.JS МОНИТОРИНГІ", runtimeOverview: "Ортаға шолу",
    liveSignal: "Қолданбаның күйі нақты уақытта көрсетіледі.", selectSession: "Сессияны таңдаңыз",
    selectRuntimeSession: "Орындалу ортасының сессиясын таңдаңыз", exportReport: "Есепті экспорттау",
    currentMetrics: "Ағымдағы көрсеткіштер", cpuUsage: "CPU ЖҮКТЕМЕСІ", oneCore: "бір ядроның үлесі",
    processCpu: "Процесс CPU-ы", memoryRss: "RSS ЖАДЫ", residentSet: "Резиденттік жад",
    waitingMetrics: "Көрсеткіштер күтілуде", eventLoopLag: "ОҚИҒАЛАР ЦИКЛІНІҢ КІДІРІСІ",
    meanInterval: "аралықтағы орташа мән", aboveThreshold: "100 мс шегінен жоғары",
    expectedRange: "Қалыпты ауқымда", httpP95: "HTTP P95 КІДІРІСІ", requestsObserved: "сұрау қабылданды",
    serverErrors: "сервер қатесі", processHealth: "Процесс күйі", lastSamples: "Соңғы 60 өлшем",
    live: "НАҚТЫ УАҚЫТТА", waitingFirstSample: "Алғашқы өлшем күтілуде",
    startAgent: "Процесс көрсеткіштерін көру үшін Node.js агентін іске қосыңыз.",
    cpuNormalized: "CPU бір логикалық ядроға шақталған; мәні 100%-дан асуы мүмкін.",
    updated: "Жаңартылды", noSamples: "Әзірге өлшем жоқ", runtimeFingerprint: "Орындалу ортасының ізі", reproduceEnvironment: "Осы ортаны қайта жасау",
    appVersion: "ҚОЛДАНБА НҰСҚАСЫ", gitCommit: "GIT КОМИТІ", nodeJs: "NODE.JS",
    platform: "ПЛАТФОРМА", process: "ПРОЦЕСС", fingerprintUnavailable: "Орындалу ортасының ізі қолжетімсіз",
    connectAgent: "Орындалу ортасы туралы мәлімет алу үшін агентті қосыңыз.",
    noSecrets: "Ортаның құпия деректері жиналмайды.", incidentTimeline: "Оқиғалар хронологиясы",
    signalsAround: "Маңызды сәттердегі сигналдар", viewActivity: "Белсенділікті көрсету",
    quietSoFar: "Әзірге бәрі тыныш", incidentsWillAppear: "Қателер, ауытқулар және HTTP 5xx жауаптары осында көрсетіледі.",
    regressionWatch: "Регрессияны бақылау", compareBaseline: "Осы іске қосуды эталонмен салыстыру",
    runDiff: "ІСКЕ ҚОСУЛАР САЛЫСТЫРУЫ", baselineSession: "ЭТАЛОН СЕССИЯ",
    choosePreviousRun: "Алдыңғы іске қосуды таңдаңыз", signalsTrendingUp: "Кейбір көрсеткіштер өсіп жатыр",
    noRegressions: "Елеулі регрессия анықталмады", medianCurrentBaseline: "Медиана · ағымдағы және эталон",
    rssMemory: "RSS жады", httpLatency: "HTTP кідірісі",
    chooseSessionCompare: "CPU, жад және кідірісті салыстыру үшін алдыңғы сессияны таңдаңыз.",
    sameHostComparison: "Бір құрылғыдағы салыстыру · медианалық мәндер, диагноз емес",
    liveActivity: "Нақты уақыттағы белсенділік",
    sanitizedActivity: "Тазартылған журналдар, ерекше жағдайлар және сұрау іздері",
    logsErrors: "Журналдар мен қателер", downloadJson: "JSON есебін жүктеу", time: "УАҚЫТ", type: "ТҮРІ",
    detail: "МӘЛІМЕТ", severity: "МАҢЫЗДЫЛЫҒЫ", source: "КӨЗІ", noActivity: "Әзірге белсенділік жоқ",
    activityWillAppear: "Жиналған журналдар, қателер және HTTP трафигі нақты уақытта осында көрсетіледі.",
    recentHttpRequests: "Соңғы HTTP сұраулары",
    routePatterns: "Бастапқы URL орнына маршрут үлгілері сақталады", captured: "қабылданды",
    method: "ӘДІС", route: "МАРШРУТ", status: "КҮЙІ", latency: "КІДІРІС",
    noRequests: "Әзірге сұрау жоқ", installMiddleware: "Node.js HTTP серверіне httpMiddleware(agent) қосыңыз.",
    recentSessions: "Соңғы сессиялар", persistentHistory: "Жергілікті тарих сақталады",
    sessionCount: "сессия", events: "оқиға",
    sessionsSaved: "Орындалу ортасының сессиялары осында автоматты түрде сақталады.",
    localFirst: "Node.js жергілікті мониторингі", dataRemains: "Деректер құрылғыңызда сақталады",
    language: "Тіл", error: "Қате", anomaly: "Ауытқу", info: "Ақпарат", warning: "Ескерту",
    critical: "Қауіпті", runtimeError: "Орындалу ортасының қатесі", httpResponse: "HTTP жауабы",
    setupTitle: "Алғашқы қолданбаны қосыңыз", setupCopy: "Жаңа PowerShell терезесінде Node.js демо қызметін іске қосыңыз. Ол мұнда көрсеткіштерді, сұрауларды және сынақ оқиғаларын жібереді.",
    setupRunDemo: "1. Жоба бумасынан демоны іске қосыңыз", setupSendRequests: "2. Сынақ белсенділігін жасаңыз",
    copyCommand: "Команданы көшіру", commandCopied: "Көшірілді",
    setupPrivacy: "Команда Runtime Radar жергілікті токенін өзі оқиды; құпияны енгізу не жариялау қажет емес.",
    clipboardUnavailable: "Команданы көшіру мүмкін болмады. Оны қолмен көшіріңіз."
  }
} as const;

const apiBase = "";

async function fetchJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${path}`);
  return response.json() as Promise<T>;
}

function bytes(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ago(timestamp: number, language: Language): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  const locale = language === "ru" ? "ru-RU" : "kk-KZ";
  if (seconds < 60) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-seconds, "second");
  if (seconds < 3_600) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(seconds / 60), "minute");
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(seconds / 3_600), "hour");
}

function clock(timestamp: number, language: Language): string {
  const locale = language === "ru" ? "ru-RU" : "kk-KZ";
  return new Date(timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fingerprintOf(session: SessionSummary | undefined, events: RuntimeEvent[]): RuntimeFingerprint | null {
  if (session?.fingerprint) return session.fingerprint;
  const started = events.find((event) => event.type === "lifecycle" && event.data.state === "started");
  const fingerprint = started?.data.fingerprint;
  return fingerprint && typeof fingerprint === "object" ? fingerprint as RuntimeFingerprint : null;
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("runtime-radar-language");
    return saved === "kk" ? "kk" : "ru";
  });
  const t: Copy = translations[language];
  const locale = language === "ru" ? "ru-RU" : "kk-KZ";
  const [token, setToken] = useState("");
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [regression, setRegression] = useState<Regression | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedCommand, setCopiedCommand] = useState("");
  const [filter, setFilter] = useState<"all" | "incident" | "http">("all");
  const [now, setNow] = useState(Date.now());
  const selectedSessionId = useRef(sessionId);
  selectedSessionId.current = sessionId;
  const selectedSession = sessions.find((session) => session.id === sessionId);
  const selectedSessionActive = selectedSession?.endedAt === null;

  useEffect(() => {
    localStorage.setItem("runtime-radar-language", language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    let alive = true;
    fetch("/api/bootstrap", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Cannot connect to the local Runtime Radar core.");
        return response.json() as Promise<{ token: string }>;
      })
      .then(({ token: runtimeToken }) => {
        if (alive) setToken(runtimeToken);
      })
      .catch((error: unknown) => {
        if (alive) {
          setConnection("offline");
          setErrorMessage(error instanceof Error ? error.message : "Dashboard bootstrap failed.");
        }
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const loadSessions = async (): Promise<SessionSummary[]> => {
      const result = await fetchJson<{ sessions: SessionSummary[] }>("/api/sessions", token);
      if (alive) setSessions(result.sessions);
      return result.sessions;
    };
    void loadSessions()
      .then((result) => {
        if (!alive) return;
        setErrorMessage("");
        const active = result.find((session) => session.endedAt === null);
        setSessionId((selected) => selected || active?.id || result[0]?.id || "");
        setBaselineId((selected) => selected || result.find((session) => session.endedAt !== null)?.id || "");
        setConnection(active ? "live" : "offline");
      })
      .catch((error: unknown) => {
        if (alive) {
          setConnection("offline");
          setErrorMessage(error instanceof Error ? error.message : "Unable to load sessions.");
        }
      });
    const poll = window.setInterval(() => {
      void loadSessions().catch((error: unknown) => {
        if (alive) {
          setConnection("offline");
          setErrorMessage(error instanceof Error ? error.message : "Unable to refresh sessions.");
        }
      });
    }, 5_000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let reconnectTimer = 0;
    let socket: WebSocket | undefined;
    const refreshEvents = async (): Promise<void> => {
      if (!sessionId) return;
      try {
        const result = await fetchJson<{ events: RuntimeEvent[] }>(
          `/api/events?sessionId=${encodeURIComponent(sessionId)}&limit=500`, token
        );
        if (alive) setEvents((current) => {
          const merged = new Map(result.events.map((event) => [event.id, event]));
          for (const event of current) {
            if (event.sessionId === sessionId) merged.set(event.id, event);
          }
          return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-2_000);
        });
      } catch (error) {
        if (alive) setErrorMessage(error instanceof Error ? error.message : "Unable to load session events.");
      }
    };
    setEvents([]);
    void refreshEvents();

    const connect = (): void => {
      if (!alive) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${scheme}//${location.host}/stream`, ["runtime-radar-auth", token]);
      socket.onopen = () => {
        if (alive) setConnection((current) => current === "live" ? current : "offline");
        void refreshEvents();
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as RuntimeEvent;
          if (event.type === "lifecycle" && event.data.state === "started") {
            setConnection("live");
            if (!selectedSessionId.current) setSessionId(event.sessionId);
            void fetchJson<{ sessions: SessionSummary[] }>("/api/sessions", token)
              .then((result) => setSessions(result.sessions))
              .catch((error: unknown) => {
                if (alive) setErrorMessage(error instanceof Error ? error.message : "Unable to refresh sessions.");
              });
            return;
          }
          if (event.sessionId === sessionId) {
            setEvents((current) => current.some((item) => item.id === event.id)
              ? current : [...current, event].slice(-2_000));
          }
        } catch {
          setErrorMessage("Received an unreadable event from the local core.");
        }
      };
      socket.onerror = () => {
        if (alive) setConnection("offline");
      };
      socket.onclose = () => {
        if (!alive) return;
        setConnection("offline");
        reconnectTimer = window.setTimeout(connect, 1_500);
      };
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token, sessionId]);

  useEffect(() => {
    if (!token || !sessionId || !baselineId || !selectedSessionActive) {
      setRegression(null);
      return;
    }
    const load = (): void => {
      fetchJson<Regression>(
        `/api/regression?sessionId=${encodeURIComponent(sessionId)}&baselineId=${encodeURIComponent(baselineId)}`,
        token
      )
        .then(setRegression)
        .catch((error: unknown) => {
          setRegression(null);
          setErrorMessage(error instanceof Error ? error.message : "Unable to compare sessions.");
        });
    };
    load();
    const timer = window.setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [token, sessionId, baselineId, selectedSessionActive]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const fingerprint = fingerprintOf(selectedSession, events);
  const metrics = useMemo(() => events
    .filter((event) => event.type === "metric")
    .slice(-60)
    .map((event) => ({
      timestamp: event.timestamp,
      time: new Date(event.timestamp).toLocaleTimeString(locale, { minute: "2-digit", second: "2-digit" }),
      cpu: Number(event.data.cpuPercent) || 0,
      rss: Number(event.data.rssBytes) / 1024 / 1024 || 0,
      lag: Number(event.data.eventLoopLagMs) || 0
    })), [events, locale]);
  const latest = metrics[metrics.length - 1];
  const requests = events.filter((event) => event.type === "http");
  const latencies = requests.map((event) => Number(event.data.durationMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : null;
  const incidents = events.filter((event) => event.type === "error" || event.type === "anomaly");
  const timeline = events.filter((event) => event.type === "error" || event.type === "anomaly" ||
    (event.type === "http" && Number(event.data.statusCode) >= 500)).slice(-12).reverse();
  const filteredEvents = events.filter((event) => {
    if (filter === "incident") return event.type === "error" || event.type === "anomaly";
    if (filter === "http") return event.type === "http";
    return event.type === "log" || event.type === "error" || event.type === "anomaly";
  }).slice(-30).reverse();
  const cpuDelta = regression?.metrics.cpuPercent?.changePercent;
  const memoryDelta = regression?.metrics.rssBytes?.changePercent;
  const isDegrading = [cpuDelta, memoryDelta, regression?.metrics.httpLatencyMs?.changePercent]
    .some((value) => value !== null && value !== undefined && value > 10);

  const exportReport = (format: "json" | "markdown"): void => {
    if (!sessionId) return;
    const link = document.createElement("a");
    link.href = `/api/export?sessionId=${encodeURIComponent(sessionId)}&format=${format}`;
    link.download = `runtime-radar-${sessionId}.${format === "json" ? "json" : "md"}`;
    // Downloads use a short-lived authenticated fetch so credentials never enter the URL.
    void fetch(link.href, { headers: { authorization: `Bearer ${token}` } }).then(async (response) => {
      if (!response.ok) throw new Error("Report export failed.");
      const blob = await response.blob();
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
    }).catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : "Report export failed."));
  };

  const copyCommand = (id: string, command: string): void => {
    void navigator.clipboard.writeText(command)
      .then(() => setCopiedCommand(id))
      .catch(() => setErrorMessage(t.clipboardUnavailable));
  };
  const demoCommand = `$env:RUNTIME_RADAR_TOKEN = (Get-Content .runtime-radar\\token -Raw).Trim()\nnpm run demo`;
  const sampleCommand = "Invoke-RestMethod http://127.0.0.1:4320/health\nInvoke-RestMethod http://127.0.0.1:4320/slow\nInvoke-RestMethod http://127.0.0.1:4320/busy?ms=500";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Runtime Radar home">
          <span className="brand-mark"><Radio size={19} strokeWidth={2.3} /></span>
          <span>runtime<span className="brand-light">radar</span></span>
        </a>
        <div className="workspace-label">{t.workspace}</div>
        <button className="nav-item selected"><Activity size={17} /> {t.overview} <span className="nav-dot" /></button>
        <a className="nav-item" href="#incidents"><TriangleAlert size={17} /> {t.incidents} <span className="nav-count">{incidents.length}</span></a>
        <a className="nav-item" href="#traffic"><Waves size={17} /> {t.httpTraffic}</a>
        <a className="nav-item" href="#sessions"><Clock3 size={17} /> {t.sessions}</a>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={16} />
            <div><strong>{t.privateByDefault}</strong><span>{t.dataOnMachine}</span></div>
          </div>
          <div className="version">RUNTIME RADAR <span>v0.1.0</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">{t.projects} <span>/</span> <strong>{fingerprint?.appName ?? selectedSession?.processName ?? t.application}</strong></div>
          <div className="topbar-actions">
            <span className={`connection-pill ${connection}`}><i />{connection === "live" ? t.liveMonitoring : connection === "connecting" ? t.connecting : t.waitingForAgent}</span>
            <select className="language-select" aria-label={t.language} title={t.language} value={language} onChange={(event) => setLanguage(event.target.value === "kk" ? "kk" : "ru")}>
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
            </select>
            <button className="icon-button" onClick={() => window.location.reload()} title={t.refreshDashboard}><RefreshCw size={16} /></button>
            <div className="avatar">RR</div>
          </div>
        </header>

        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> {t.observability}</div>
              <h1>{t.runtimeOverview}</h1>
              <p className="subtitle">{t.liveSignal}</p>
            </div>
            <div className="heading-controls">
              <select aria-label={t.selectRuntimeSession} value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
                <option value="">{t.selectSession}</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.processName} · {new Date(session.startedAt).toLocaleString(locale)}
                  </option>
                ))}
              </select>
              <button className="export-button" disabled={!sessionId} onClick={() => exportReport("markdown")}><Download size={15} /> {t.exportReport}</button>
            </div>
          </div>

          {connection !== "live" && <section className="setup-card">
            <div className="setup-heading"><span className="setup-icon"><Zap size={17} /></span><div><h2>{t.setupTitle}</h2><p>{t.setupCopy}</p></div></div>
            <div className="setup-steps">
              <div className="setup-step"><strong>{t.setupRunDemo}</strong><pre><code>{demoCommand}</code><button className="copy-command" onClick={() => copyCommand("demo", demoCommand)}>{copiedCommand === "demo" ? t.commandCopied : t.copyCommand}</button></pre></div>
              <div className="setup-step"><strong>{t.setupSendRequests}</strong><pre><code>{sampleCommand}</code><button className="copy-command" onClick={() => copyCommand("requests", sampleCommand)}>{copiedCommand === "requests" ? t.commandCopied : t.copyCommand}</button></pre></div>
            </div>
            <p className="setup-privacy"><ShieldCheck size={14} /> {t.setupPrivacy}</p>
          </section>}

          {errorMessage && <div className="notice"><TriangleAlert size={16} /> {errorMessage}</div>}

          <section className="metric-grid" aria-label={t.currentMetrics}>
            <MetricCard icon={<Cpu size={17} />} label={t.cpuUsage} value={latest ? `${latest.cpu.toFixed(1)}%` : "—"} unit={t.oneCore} detail={t.processCpu} tone="violet" data={metrics.map((item) => item.cpu)} />
            <MetricCard icon={<HardDrive size={17} />} label={t.memoryRss} value={latest ? `${latest.rss.toFixed(1)} MB` : "—"} unit={t.residentSet} detail={latest ? `Heap ${bytes(events.filter((item) => item.type === "metric").slice(-1)[0]?.data.heapUsedBytes)}` : t.waitingMetrics} tone="blue" data={metrics.map((item) => item.rss)} />
            <MetricCard icon={<Zap size={17} />} label={t.eventLoopLag} value={latest ? `${latest.lag.toFixed(1)} ms` : "—"} unit={t.meanInterval} detail={latest && latest.lag > 100 ? t.aboveThreshold : t.expectedRange} tone={latest && latest.lag > 100 ? "orange" : "green"} data={metrics.map((item) => item.lag)} />
            <MetricCard icon={<Waves size={17} />} label={t.httpP95} value={p95 === null ? "—" : `${p95.toFixed(0)} ms`} unit={`${requests.length} ${t.requestsObserved}`} detail={`${requests.filter((event) => Number(event.data.statusCode) >= 500).length} ${t.serverErrors}`} tone="teal" data={latencies.slice(-20)} />
          </section>

          <section className="primary-grid">
            <article className="panel chart-panel">
              <div className="panel-header">
                <div><h2>{t.processHealth}</h2><p>{t.lastSamples} <span className="live-indicator"><i /> {t.live}</span></p></div>
                <div className="chart-legend"><span><i className="legend-cpu" /> CPU</span><span><i className="legend-memory" /> RSS <small>MB</small></span></div>
              </div>
              <div className="chart-wrap">
                {metrics.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics} margin={{ top: 12, right: 8, bottom: 0, left: -16 }}>
                      <defs>
                        <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.24} /><stop offset="95%" stopColor="#a78bfa" stopOpacity={0} /></linearGradient>
                        <linearGradient id="memoryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#42b8e9" stopOpacity={0.17} /><stop offset="95%" stopColor="#42b8e9" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid stroke="#202631" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: "#677284", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={26} />
                      <YAxis yAxisId="left" tick={{ fill: "#677284", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => `${value}%`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: "#677284", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => `${value}`} />
                      <Tooltip contentStyle={{ background: "#151a23", border: "1px solid #293241", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5eaf2" }} />
                      <Area yAxisId="left" type="monotone" dataKey="cpu" name="CPU %" stroke="#a78bfa" strokeWidth={2} fill="url(#cpuFill)" isAnimationActive={false} />
                      <Area yAxisId="right" type="monotone" dataKey="rss" name="RSS MB" stroke="#42b8e9" strokeWidth={1.8} fill="url(#memoryFill)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <EmptyState icon={<Activity size={20} />} title={t.waitingFirstSample} copy={t.startAgent} />}
              </div>
              <div className="chart-foot"><span>{t.cpuNormalized}</span><span>{latest ? `${t.updated} ${ago(latest.timestamp, language)}` : t.noSamples}</span></div>
            </article>

            <article className="panel fingerprint-panel">
              <div className="panel-header"><div><h2>{t.runtimeFingerprint}</h2><p>{t.reproduceEnvironment}</p></div><span className="fingerprint-icon"><ShieldCheck size={16} /></span></div>
              {fingerprint ? (
                <div className="fingerprint-list">
                  <FingerprintRow label={t.application.toUpperCase()} value={fingerprint.appName} />
                  <FingerprintRow label={t.appVersion} value={fingerprint.appVersion} />
                  <FingerprintRow label={t.gitCommit} value={fingerprint.gitCommit} mono />
                  <FingerprintRow label={t.nodeJs} value={fingerprint.nodeVersion} />
                  <FingerprintRow label={t.platform} value={`${fingerprint.platform} · ${fingerprint.arch}`} />
                  <FingerprintRow label={t.process} value={`PID ${fingerprint.pid}`} />
                </div>
              ) : <EmptyState icon={<ShieldCheck size={19} />} title={t.fingerprintUnavailable} copy={t.connectAgent} />}
              <div className="fingerprint-note"><span className="note-dot" /> {t.noSecrets}</div>
            </article>
          </section>

          <section className="secondary-grid">
            <article className="panel timeline-panel" id="incidents">
              <div className="panel-header">
                <div><h2>{t.incidentTimeline}</h2><p>{t.signalsAround}</p></div>
                <a className="text-link" href="#activity">{t.viewActivity} <ArrowUpRight size={13} /></a>
              </div>
              <div className="timeline-list">
                {timeline.length ? timeline.map((event) => <TimelineItem key={event.id} event={event} copy={t} language={language} />) :
                  <EmptyState icon={<ShieldCheck size={19} />} title={t.quietSoFar} copy={t.incidentsWillAppear} />}
              </div>
            </article>

            <article className="panel regression-panel">
              <div className="panel-header"><div><h2>{t.regressionWatch}</h2><p>{t.compareBaseline}</p></div><span className="regression-badge"><Activity size={13} /> {t.runDiff}</span></div>
              <label className="select-label" htmlFor="baseline-session">{t.baselineSession}</label>
              <select id="baseline-session" className="baseline-select" value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>
                <option value="">{t.choosePreviousRun}</option>
                {sessions.filter((session) => session.id !== sessionId).map((session) => (
                  <option key={session.id} value={session.id}>{session.processName} · {new Date(session.startedAt).toLocaleString(locale)}</option>
                ))}
              </select>
              {regression ? (
                <>
                  <div className="regression-summary">
                    <span className={`trend-icon ${isDegrading ? "up" : "down"}`}>{isDegrading ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</span>
                    <div><strong>{isDegrading ? t.signalsTrendingUp : t.noRegressions}</strong><span>{t.medianCurrentBaseline}</span></div>
                  </div>
                  <div className="diff-list">
                    <DiffRow label="CPU" value={regression.metrics.cpuPercent?.changePercent} />
                    <DiffRow label={t.rssMemory} value={regression.metrics.rssBytes?.changePercent} />
                    <DiffRow label={t.httpLatency} value={regression.metrics.httpLatencyMs?.changePercent} />
                  </div>
                </>
              ) : <div className="regression-empty"><Activity size={17} /><span>{t.chooseSessionCompare}</span></div>}
              <div className="regression-foot">{t.sameHostComparison}</div>
            </article>
          </section>

          <section className="panel activity-panel" id="activity">
            <div className="panel-header activity-header">
              <div><h2>{t.liveActivity}</h2><p>{t.sanitizedActivity}</p></div>
              <div className="activity-actions">
                <div className="segmented">
                  {(["all", "incident", "http"] as const).map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item === "all" ? t.logsErrors : item === "incident" ? t.incidents : "HTTP"}</button>)}
                </div>
                <button className="download-icon" title={t.downloadJson} disabled={!sessionId} onClick={() => exportReport("json")}><Download size={15} /></button>
              </div>
            </div>
            <div className="activity-table-wrap">
              <table className="activity-table">
                <thead><tr><th>{t.time}</th><th>{t.type}</th><th>{t.detail}</th><th>{t.severity}</th><th>{t.source}</th></tr></thead>
                <tbody>
                  {filteredEvents.map((event) => <ActivityRow key={event.id} event={event} copy={t} language={language} />)}
                </tbody>
              </table>
              {!filteredEvents.length && <EmptyState icon={<Radio size={19} />} title={t.noActivity} copy={t.activityWillAppear} />}
            </div>
          </section>

          <section className="panel traffic-panel" id="traffic">
            <div className="panel-header"><div><h2>{t.recentHttpRequests}</h2><p>{t.routePatterns}</p></div><a className="text-link" href="#traffic">{requests.length} {t.captured} <ArrowUpRight size={13} /></a></div>
            <div className="activity-table-wrap">
              <table className="activity-table request-table">
                <thead><tr><th>{t.time}</th><th>{t.method}</th><th>{t.route}</th><th>{t.status}</th><th>{t.latency}</th></tr></thead>
                <tbody>
                  {requests.slice(-8).reverse().map((event) => (
                    <tr key={event.id}>
                      <td className="muted-cell">{clock(event.timestamp, language)}</td>
                      <td><span className="method-chip">{String(event.data.method ?? "—")}</span></td>
                      <td className="route-cell">{String(event.data.route ?? "/unmatched")}</td>
                      <td><span className={`status-code ${Number(event.data.statusCode) >= 500 ? "bad" : Number(event.data.statusCode) >= 400 ? "warn" : "good"}`}>{String(event.data.statusCode ?? "—")}</span></td>
                      <td className={Number(event.data.durationMs) > 500 ? "latency-slow" : ""}>{Number(event.data.durationMs).toFixed(1)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!requests.length && <EmptyState icon={<Waves size={18} />} title={t.noRequests} copy={t.installMiddleware} />}
            </div>
          </section>

          <section className="sessions-row" id="sessions">
            <div className="session-heading"><div><h2>{t.recentSessions}</h2><p>{t.persistentHistory}</p></div><span className="session-count">{sessions.length} {t.sessionCount}</span></div>
            <div className="session-list">
              {sessions.slice(0, 4).map((session) => (
                <button key={session.id} className={`session-card ${session.id === sessionId ? "active" : ""}`} onClick={() => setSessionId(session.id)}>
                  <span className={`session-status ${session.endedAt === null ? "running" : ""}`} />
                  <span className="session-name">{session.processName}<small>{new Date(session.startedAt).toLocaleString(locale)}</small></span>
                  <span className="session-events">{session.eventCount} {t.events}</span>
                  <span className="session-age">{ago(session.startedAt, language)}</span>
                </button>
              ))}
              {!sessions.length && <div className="session-empty">{t.sessionsSaved}</div>}
            </div>
          </section>

          <footer><span>Runtime Radar</span><span>{t.localFirst} <i /> {t.dataRemains}</span><span>{new Date(now).toLocaleTimeString(locale)}</span></footer>
        </div>
      </main>
    </div>
  );
}

function MetricCard({ icon, label, value, unit, detail, tone, data }: {
  icon: ReactNode; label: string; value: string; unit: string; detail: string; tone: string; data: number[];
}) {
  const points = data.length ? data.slice(-18) : [0, 0, 0, 0];
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const path = points.map((point, index) => {
    const x = points.length === 1 ? 50 : index / (points.length - 1) * 100;
    const y = 35 - ((point - min) / Math.max(max - min, 1)) * 28;
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-card-top"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><span className="sparkline"><svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d={path} /></svg></span></div>
      <div className="metric-value">{value}</div>
      <div className="metric-unit">{unit}</div>
      <div className="metric-foot"><span className="foot-status" />{detail}</div>
    </article>
  );
}

function FingerprintRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="fingerprint-row"><span>{label}</span><strong className={mono ? "mono" : ""} title={value}>{value}</strong></div>;
}

function EmptyState({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><strong>{title}</strong><span>{copy}</span></div>;
}

function TimelineItem({ event, copy, language }: { event: RuntimeEvent; copy: Copy; language: Language }) {
  const isAnomaly = event.type === "anomaly";
  const statusCode = Number(event.data.statusCode);
  const title = String(event.data.title ?? event.data.message ?? (statusCode ? `HTTP ${statusCode} ${copy.httpResponse}` : copy.runtimeError));
  const details = String(event.data.details ?? event.data.route ?? event.data.name ?? "");
  return <div className="timeline-item">
    <span className={`timeline-marker ${event.severity === "critical" || statusCode >= 500 ? "critical" : "warning"}`}>{isAnomaly ? <Zap size={12} /> : <TriangleAlert size={12} />}</span>
    <div className="timeline-copy"><strong>{title}</strong><span>{details}</span></div>
    <time>{clock(event.timestamp, language)}</time>
  </div>;
}

function ActivityRow({ event, copy, language }: { event: RuntimeEvent; copy: Copy; language: Language }) {
  const title = String(event.data.title ?? event.data.message ?? JSON.stringify(event.data));
  const isError = event.type === "error";
  const severity = event.severity ?? (isError ? "critical" : "info");
  const eventType = event.type === "error" ? copy.error : event.type === "anomaly" ? copy.anomaly : event.type;
  const severityLabel = severity === "critical" ? copy.critical : severity === "warning" ? copy.warning : severity === "info" ? copy.info : severity;
  return <tr>
    <td className="muted-cell">{clock(event.timestamp, language)}</td>
    <td><span className={`type-pill ${event.type}`}>{eventType}</span></td>
    <td className="detail-cell" title={title}>{title}</td>
    <td><span className={`severity ${severity}`}><i />{severityLabel}</span></td>
    <td className="source-cell">{event.source}</td>
  </tr>;
}

function DiffRow({ label, value }: { label: string; value: number | null | undefined }) {
  const hasValue = value !== null && value !== undefined;
  const worse = hasValue && value > 0;
  return <div className="diff-row"><span>{label}</span><div className="diff-meter"><i style={{ width: `${hasValue ? Math.min(Math.abs(value), 100) : 0}%` }} /></div><strong className={!hasValue ? "neutral" : worse ? "worse" : "better"}>{hasValue ? `${value > 0 ? "+" : ""}${value.toFixed(1)}%` : "—"}</strong></div>;
}
