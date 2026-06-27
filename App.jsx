import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Clipboard,
  FileJson,
  List,
  Pause,
  Play,
  Printer,
  RotateCcw,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  TimerReset,
  Volume2,
  VolumeX
} from "lucide-react";
import { flashcards } from "./data/flashcards";
import milindStudyQuestions from "./data/milindStudyQuestions.json";
import { useLocalStorage } from "./hooks/useLocalStorage";

const questionsKey = "quizmate-questions-v2";
const progressKey = "quizmate-progress-v2";
const confidenceLabels = ["Easy", "Medium", "Difficult"];
const timerOptions = [30, 45, 60];
const MILIND_STUDY_CODE = "1208";

const chatGptPrompt = `You are an English speaking practice assistant.

Read my notes and create 20 speaking practice flashcards.

Return only a valid JSON array. Do not add explanation.

Use this format:
[
{
"question": "Question text here",
"answer": "Suggested answer here"
}
]

Rules:

* Create clear and natural speaking questions.
* Answers should be simple, professional and suitable for speaking practice.
* Each answer should be around 50-80 words.
* Use simple English.
* Keep the answers natural for speaking.
* Do not use very difficult vocabulary.
* Do not include markdown.
* Return only the JSON array.

Here are my notes:
PASTE YOUR NOTES HERE`;

function createInitialQuestions() {
  return flashcards.map((card) => ({
    ...card,
    id: `starter-${card.id}`
  }));
}

function createBlankProgress(cards) {
  return cards.reduce((items, card) => {
    items[card.id] = {
      confidence: "Medium",
      status: "new",
      editedAnswer: ""
    };
    return items;
  }, {});
}

function mergeProgress(cards, saved) {
  const blanks = createBlankProgress(cards);
  return cards.reduce((items, card) => {
    items[card.id] = { ...blanks[card.id], ...(saved?.[card.id] || {}) };
    return items;
  }, {});
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function normalizeImportedQuestions(items) {
  return items.map((item, index) => ({
    id: `imported-${Date.now()}-${index}`,
    question: String(item.question).trim(),
    answer: String(item.answer).trim()
  }));
}

function normalizeMilindStudyQuestions(items) {
  if (!Array.isArray(items)) {
    throw new Error("Milind Study data must be an array.");
  }

  return items.map((item, index) => {
    const question = String(item?.question || "").trim();
    const answer = String(item?.answer || "").trim();
    if (!question || !answer) {
      throw new Error(`Milind Study question ${index + 1} is missing question or answer.`);
    }

    return {
      id: item.id || crypto.randomUUID(),
      topic: item.topic || "",
      question,
      answer,
      confidence: "not-started"
    };
  });
}

export default function App() {
  const [questions, setQuestions] = useLocalStorage(questionsKey, createInitialQuestions());
  const [progress, setProgress] = useLocalStorage(progressKey, createBlankProgress(createInitialQuestions()));
  const [activeIndex, setActiveIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [view, setView] = useState("practice");
  const [query, setQuery] = useState("");
  const [timerLength, setTimerLength] = useState(45);
  const [timeLeft, setTimeLeft] = useState(45);
  const [timerRunning, setTimerRunning] = useState(false);
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [copied, setCopied] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [importMode, setImportMode] = useState("add");
  const [importMessage, setImportMessage] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewQuestionTime, setPreviewQuestionTime] = useState(8);
  const [previewAnswerTime, setPreviewAnswerTime] = useState(10);
  const [autoSpeakPreview, setAutoSpeakPreview] = useState(false);
  const [milindModalOpen, setMilindModalOpen] = useState(false);
  const [milindCode, setMilindCode] = useState("");
  const [milindMessage, setMilindMessage] = useState("");

  useEffect(() => {
    [
      "islpr-speaking-practice-v1",
      "islpr-speaking-questions-v2",
      "islpr-speaking-progress-v2",
      "quizmate-questions-v1",
      "quizmate-progress-v1"
    ].forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore blocked storage; the active app state still works without it.
      }
    });
  }, []);

  const safeQuestions = questions?.length ? questions : createInitialQuestions();
  const activeCard = safeQuestions[Math.min(activeIndex, safeQuestions.length - 1)] || safeQuestions[0];
  const safeProgress = useMemo(() => mergeProgress(safeQuestions, progress), [safeQuestions, progress]);
  const activeProgress = activeCard ? safeProgress[activeCard.id] : {};
  const activeAnswer = activeProgress.editedAnswer || activeCard?.answer || "";

  const weakCards = useMemo(
    () =>
      safeQuestions.filter((card) => {
        const item = safeProgress[card.id];
        return item.confidence === "Difficult" || item.status === "practice";
      }),
    [safeQuestions, safeProgress]
  );

  const filteredCards = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return safeQuestions;
    return safeQuestions.filter((card) => {
      const answer = safeProgress[card.id].editedAnswer || card.answer;
      return `${card.question} ${answer}`.toLowerCase().includes(term);
    });
  }, [query, safeQuestions, safeProgress]);

  const stats = useMemo(() => {
    const values = Object.values(safeProgress);
    return {
      total: safeQuestions.length,
      completed: values.filter((item) => item.status === "known").length,
      difficult: values.filter((item) => item.confidence === "Difficult").length,
      practice: values.filter((item) => item.status === "practice").length
    };
  }, [safeQuestions, safeProgress]);

  const progressPercent = safeQuestions.length ? Math.round(((activeIndex + 1) / safeQuestions.length) * 100) : 0;

  useEffect(() => {
    if (!timerRunning) return undefined;
    if (timeLeft === 0) {
      setTimerRunning(false);
      return undefined;
    }
    const tick = window.setInterval(() => setTimeLeft((value) => value - 1), 1000);
    return () => window.clearInterval(tick);
  }, [timerRunning, timeLeft]);

  useEffect(() => {
    setTimeLeft(timerLength);
    setTimerRunning(false);
  }, [timerLength, activeIndex]);

  useEffect(() => {
    if (activeIndex >= safeQuestions.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, safeQuestions.length]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (previewOpen || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setShowAnswer((value) => !value);
      }
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrevious();
      if (event.key.toLowerCase() === "r") chooseRandom();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function updateCard(cardId, patch) {
    setProgress((current) => {
      const merged = mergeProgress(safeQuestions, current);
      return {
        ...merged,
        [cardId]: {
          ...merged[cardId],
          ...patch
        }
      };
    });
  }

  function selectCard(index, nextView = "practice") {
    setActiveIndex(index);
    setShowAnswer(false);
    setEditingAnswer(false);
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goNext() {
    selectCard((activeIndex + 1) % safeQuestions.length, view === "list" ? "practice" : view);
  }

  function goPrevious() {
    selectCard((activeIndex - 1 + safeQuestions.length) % safeQuestions.length, view === "list" ? "practice" : view);
  }

  function chooseRandom() {
    if (safeQuestions.length < 2) return;
    let next = activeIndex;
    while (next === activeIndex) {
      next = Math.floor(Math.random() * safeQuestions.length);
    }
    selectCard(next, "practice");
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  function stopVoice() {
    window.speechSynthesis?.cancel();
  }

  async function copyText(text, label) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1400);
  }

  function startEditingAnswer() {
    setDraftAnswer(activeAnswer);
    setEditingAnswer(true);
    setShowAnswer(true);
  }

  function saveEditedAnswer() {
    updateCard(activeCard.id, { editedAnswer: draftAnswer.trim() });
    setEditingAnswer(false);
  }

  function addQuestion() {
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    const card = {
      id: `custom-${Date.now()}`,
      question: newQuestion.trim(),
      answer: newAnswer.trim()
    };
    setQuestions((current) => [...(current?.length ? current : createInitialQuestions()), card]);
    setNewQuestion("");
    setNewAnswer("");
    setImportMessage("Question added successfully.");
  }

  function importQuestions() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error("not-array");
      const valid = parsed.every((item) => item?.question?.trim && item?.answer?.trim && item.question.trim() && item.answer.trim());
      if (!valid) throw new Error("invalid-items");
      const imported = normalizeImportedQuestions(parsed);
      if (importMode === "replace") {
        const confirmed = window.confirm("Are you sure you want to replace all questions?");
        if (!confirmed) return;
        setQuestions(imported);
        setProgress(createBlankProgress(imported));
      } else {
        setQuestions((current) => [...(current?.length ? current : createInitialQuestions()), ...imported]);
      }
      setJsonText("");
      setActiveIndex(0);
      setShowAnswer(false);
      setImportMessage("Questions imported successfully.");
    } catch {
      setImportMessage("Invalid JSON. Please check the format.");
    }
  }

  function restartQuiz() {
    setActiveIndex(0);
    setShowAnswer(false);
    setEditingAnswer(false);
  }

  function clearProgress() {
    const confirmed = window.confirm("Are you sure you want to reset all progress?");
    if (!confirmed) return;
    setProgress(createBlankProgress(safeQuestions));
    setShowAnswer(false);
    setEditingAnswer(false);
  }

  function loadDemoQuestions() {
    const confirmed = window.confirm("This will replace your current questions with the 5 demo questions. Do you want to continue?");
    if (!confirmed) return;
    const demoQuestions = createInitialQuestions();
    setQuestions(demoQuestions);
    setProgress(createBlankProgress(demoQuestions));
    setActiveIndex(0);
    setShowAnswer(false);
    setEditingAnswer(false);
    setImportMessage("Demo questions loaded successfully.");
  }

  function openMilindStudy() {
    setMilindCode("");
    setMilindMessage("");
    setMilindModalOpen(true);
  }

  function closeMilindStudy() {
    setMilindCode("");
    setMilindModalOpen(false);
  }

  function loadMilindStudy(event) {
    event.preventDefault();
    if (milindCode !== MILIND_STUDY_CODE) {
      setMilindMessage("Incorrect code. Please try again.");
      return;
    }

    try {
      const studyQuestions = normalizeMilindStudyQuestions(milindStudyQuestions);
      if (studyQuestions.length !== 220) {
        throw new Error("Milind Study data does not contain 220 questions.");
      }
      setQuestions(studyQuestions);
      setProgress(createBlankProgress(studyQuestions));
      setActiveIndex(0);
      setShowAnswer(false);
      setEditingAnswer(false);
      setView("practice");
      setMilindCode("");
      setMilindMessage("Milind Study loaded successfully. 220 questions are ready for practice.");
      window.setTimeout(() => setMilindModalOpen(false), 1400);
    } catch {
      setMilindMessage("Milind Study questions could not be loaded. Please check the study file.");
    }
  }

  function printPracticeSheet() {
    window.print();
  }

  return (
    <main className="app-shell min-h-screen text-ink">
      <section className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 print:hidden">
        <header className="hero-card p-5 sm:p-7">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="badge-pill">Speaking Practice Tool</span>
              <p className="mt-4 text-lg font-black text-blue-700">🎯 QuizMate</p>
              <h1 className="gradient-title mt-1 text-4xl font-black sm:text-5xl">QuizMate - Flashcard Quiz</h1>
              <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-700 sm:text-lg">
                Practise smarter with interactive flashcards, voice support and automatic preview mode.
              </p>
              <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-700">
                Welcome to QuizMate. Start with these demo cards to learn how the website works. Then import your own questions using the JSON import section.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <IconButton active={view === "practice"} label="Practice" onClick={() => setView("practice")} icon={<BookOpen size={18} />} />
              <IconButton active={view === "weak"} label="Difficult" onClick={() => setView("weak")} icon={<CheckCircle2 size={18} />} />
              <IconButton active={view === "list"} label="List" onClick={() => setView("list")} icon={<List size={18} />} />
              <IconButton active={view === "tools"} label="Tools" onClick={() => setView("tools")} icon={<FileJson size={18} />} />
              <IconButton active={false} label="Milind Study" onClick={openMilindStudy} icon={<BookOpen size={18} />} />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Total Questions" value={stats.total} icon="📚" accent="blue" />
            <Stat label="Completed" value={stats.completed} icon="✅" accent="green" />
            <Stat label="Need Practice" value={stats.practice} icon="📝" accent="orange" />
            <Stat label="Difficult" value={stats.difficult} icon="💪" accent="pink" />
            <Stat label="Current Progress" value={`${progressPercent}%`} icon="⚡" accent="purple" />
          </div>
        </header>

        {view === "list" ? (
          <ListView cards={filteredCards} query={query} setQuery={setQuery} selectCard={selectCard} progress={safeProgress} questions={safeQuestions} />
        ) : view === "tools" ? (
          <ToolsView
            promptOpen={promptOpen}
            setPromptOpen={setPromptOpen}
            copyPrompt={() => copyText(chatGptPrompt, "prompt")}
            copied={copied}
            jsonText={jsonText}
            setJsonText={setJsonText}
            importMode={importMode}
            setImportMode={setImportMode}
            importQuestions={importQuestions}
            importMessage={importMessage}
            loadDemoQuestions={loadDemoQuestions}
            newQuestion={newQuestion}
            setNewQuestion={setNewQuestion}
            newAnswer={newAnswer}
            setNewAnswer={setNewAnswer}
            addQuestion={addQuestion}
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="learning-panel p-4 sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold uppercase tracking-wide text-blue-700">
                    Question {activeIndex + 1} of {safeQuestions.length}
                  </p>
                  <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-100 sm:w-80">
                    <div className="progress-fill h-full rounded-full" style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="icon-action" onClick={chooseRandom} title="Shuffle Questions">
                    <Shuffle size={20} />
                  </button>
                  <button className="icon-action" onClick={restartQuiz} title="Restart Quiz">
                    <RotateCcw size={20} />
                  </button>
                </div>
              </div>

              <article className="flashcard">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="question-label">Question</p>
                  <span className="question-badge">Card {activeIndex + 1}</span>
                </div>
                <h2 className="mt-4 text-3xl font-black leading-tight text-slate-950 sm:text-4xl">{activeCard.question}</h2>
                <div className="step-strip mt-6">
                  <Step icon="👀" title="Read" />
                  <Step icon="🎙️" title="Speak" />
                  <Step icon="👁️" title="Check" />
                  <Step icon="🔁" title="Practise Again" />
                </div>
              </article>

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <PrimaryButton onClick={() => setShowAnswer((value) => !value)}>
                  {showAnswer ? "🙈 Hide Answer" : "👁️ Show Answer"}
                </PrimaryButton>
                <SecondaryButton onClick={() => updateCard(activeCard.id, { status: "known" })}>✅ I know this</SecondaryButton>
                <SecondaryButton onClick={() => updateCard(activeCard.id, { status: "practice" })}>📝 Need practice</SecondaryButton>
              </div>

              {showAnswer && (
                <section className="answer-card mt-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-teal-700">Suggested Answer</p>
                    <div className="flex flex-wrap gap-2">
                      <button className="small-action" onClick={() => copyText(activeAnswer, "answer")}>
                        <Clipboard size={16} /> {copied === "answer" ? "Copied" : "📋 Copy Answer"}
                      </button>
                      <button className="small-action" onClick={startEditingAnswer}>Edit Answer</button>
                    </div>
                  </div>
                  {editingAnswer ? (
                    <div className="space-y-3">
                      <textarea className="text-area min-h-44" value={draftAnswer} onChange={(event) => setDraftAnswer(event.target.value)} />
                      <div className="flex flex-wrap gap-2">
                        <PrimaryButton onClick={saveEditedAnswer}>Save Answer</PrimaryButton>
                        <SecondaryButton onClick={() => setEditingAnswer(false)}>Cancel</SecondaryButton>
                      </div>
                    </div>
                  ) : (
                    <p className="text-lg leading-relaxed">{activeAnswer}</p>
                  )}
                </section>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2 sm:flex">
                <SecondaryButton onClick={goPrevious}>⬅️ Previous Question</SecondaryButton>
                <PrimaryButton onClick={goNext}>Next Question ➡️</PrimaryButton>
              </div>
            </section>

            <aside className="flex flex-col gap-5">
              <PreviewControls
                questionTime={previewQuestionTime}
                answerTime={previewAnswerTime}
                setQuestionTime={setPreviewQuestionTime}
                setAnswerTime={setPreviewAnswerTime}
                autoSpeak={autoSpeakPreview}
                setAutoSpeak={setAutoSpeakPreview}
                start={() => setPreviewOpen(true)}
              />
              <TimerPanel
                timerLength={timerLength}
                setTimerLength={setTimerLength}
                timeLeft={timeLeft}
                timerRunning={timerRunning}
                setTimerRunning={setTimerRunning}
                reset={() => {
                  setTimerRunning(false);
                  setTimeLeft(timerLength);
                }}
              />
              <ConfidencePanel value={activeProgress.confidence} onChange={(value) => updateCard(activeCard.id, { confidence: value })} />
              <VoicePanel speakQuestion={() => speak(activeCard.question)} speakAnswer={() => speak(activeAnswer)} stopVoice={stopVoice} />
              <section className="control-card">
                <div className="grid gap-2">
                  <button className="wide-action" onClick={printPracticeSheet}>
                    <Printer size={18} /> Print Practice Sheet
                  </button>
                  <button className="wide-action danger" onClick={clearProgress}>
                    <RotateCcw size={18} /> Clear Progress
                  </button>
                </div>
              </section>
            </aside>
          </div>
        )}

        {view === "weak" && <WeakQuestions cards={weakCards} selectCard={selectCard} progress={safeProgress} questions={safeQuestions} />}
      </section>

      {previewOpen && (
        <PreviewMode
          questions={safeQuestions}
          startIndex={activeIndex}
          progress={safeProgress}
          questionTime={Math.max(1, Number(previewQuestionTime) || 8)}
          answerTime={Math.max(1, Number(previewAnswerTime) || 10)}
          autoSpeak={autoSpeakPreview}
          speak={speak}
          stopVoice={stopVoice}
          onExit={(index) => {
            stopVoice();
            setPreviewOpen(false);
            setActiveIndex(index);
            setShowAnswer(false);
          }}
        />
      )}

      {milindModalOpen && (
        <MilindStudyModal
          code={milindCode}
          message={milindMessage}
          setCode={setMilindCode}
          onSubmit={loadMilindStudy}
          onClose={closeMilindStudy}
        />
      )}

      <PrintSheet questions={safeQuestions} progress={safeProgress} />
    </main>
  );
}

function IconButton({ active, label, icon, onClick }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MilindStudyModal({ code, message, setCode, onSubmit, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="milind-study-title">
      <form className="modal-card" onSubmit={onSubmit}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="badge-pill">Private Study</p>
            <h2 id="milind-study-title" className="mt-4 text-2xl font-black text-slate-950">Milind Study</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">Enter study code</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close Milind Study">
            x
          </button>
        </div>

        <label className="field-label mt-5 block">
          Study code
          <input
            className="input-field"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
            autoComplete="off"
          />
        </label>

        {message && <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-bold text-slate-800">{message}</p>}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="submit" className="primary-button">Load Study</button>
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Stat({ label, value, icon, accent }) {
  return (
    <div className={`stat-card stat-${accent}`}>
      <span className="stat-icon">{icon}</span>
      <div>
        <p className="text-sm font-bold text-slate-600">{label}</p>
        <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
      </div>
    </div>
  );
}

function Step({ icon, title }) {
  return (
    <div className="step-card">
      <span className="text-xl">{icon}</span>
      <span>{title}</span>
    </div>
  );
}

function PreviewControls({ questionTime, answerTime, setQuestionTime, setAnswerTime, autoSpeak, setAutoSpeak, start }) {
  return (
    <section className="control-card">
      <h3 className="panel-heading">▶️ Run Preview</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="field-label">
          Question seconds
          <input className="input-field" type="number" min="1" value={questionTime} onChange={(event) => setQuestionTime(event.target.value)} />
        </label>
        <label className="field-label">
          Answer seconds
          <input className="input-field" type="number" min="1" value={answerTime} onChange={(event) => setAnswerTime(event.target.value)} />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
        Auto speak question and answer
      </label>
      <button className="wide-action success mt-4" onClick={start}>
        <Play size={18} /> Run Preview
      </button>
    </section>
  );
}

function TimerPanel({ timerLength, setTimerLength, timeLeft, timerRunning, setTimerRunning, reset }) {
  return (
    <section className="control-card">
      <div className="flex items-center justify-between">
        <h3 className="panel-heading">⏱️ Speaking Timer</h3>
        <TimerReset size={20} className="text-blue-600" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {timerOptions.map((option) => (
          <button key={option} className={`timer-option ${timerLength === option ? "active" : ""}`} onClick={() => setTimerLength(option)}>
            {option}s
          </button>
        ))}
      </div>
      <div className="timer-display">{formatTime(timeLeft)}</div>
      <div className="grid grid-cols-3 gap-2">
        <SecondaryButton onClick={() => setTimerRunning(true)}>Start</SecondaryButton>
        <SecondaryButton onClick={() => setTimerRunning(false)}>Pause</SecondaryButton>
        <SecondaryButton onClick={reset}>Reset</SecondaryButton>
      </div>
    </section>
  );
}

function ConfidencePanel({ value, onChange }) {
  return (
    <section className="control-card">
      <h3 className="panel-heading">💫 Confidence</h3>
      <div className="mt-3 grid gap-2">
        {confidenceLabels.map((label) => (
          <button key={label} className={`confidence ${value === label ? "active" : ""}`} onClick={() => onChange(label)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function VoicePanel({ speakQuestion, speakAnswer, stopVoice }) {
  return (
    <section className="control-card">
      <h3 className="panel-heading">🔊 Voice Practice</h3>
      <div className="mt-3 grid gap-2">
        <button className="wide-action" onClick={speakQuestion}>
          <Volume2 size={18} /> Speak Question
        </button>
        <button className="wide-action" onClick={speakAnswer}>
          <Volume2 size={18} /> Speak Answer
        </button>
        <button className="wide-action" onClick={stopVoice}>
          <VolumeX size={18} /> Stop Voice
        </button>
      </div>
    </section>
  );
}

function ListView({ cards, query, setQuery, selectCard, progress, questions }) {
  return (
    <section className="learning-panel p-4 sm:p-5">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600" size={19} />
        <input
          className="input-field mt-0 pl-12"
          placeholder="Search question or answer..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="mt-4 grid gap-3">
        {cards.map((card) => (
          <button key={card.id} className="list-item text-left" onClick={() => selectCard(questions.findIndex((item) => item.id === card.id))}>
            <span className="text-sm font-semibold text-moss">Flashcard {questions.findIndex((item) => item.id === card.id) + 1}</span>
            <span className="mt-1 block text-lg font-bold">{card.question}</span>
            <span className="mt-2 block text-sm text-slate-600">
              {progress[card.id].confidence} - {progress[card.id].status === "practice" ? "Need practice" : progress[card.id].status}
            </span>
          </button>
        ))}
        {cards.length === 0 && <p className="rounded-lg bg-[#fbfcf8] p-4 text-slate-600">No questions match your search.</p>}
      </div>
    </section>
  );
}

function WeakQuestions({ cards, selectCard, progress, questions }) {
  return (
    <section className="learning-panel p-4 sm:p-5">
      <h2 className="text-xl font-black">Practice Difficult Questions</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {cards.length === 0 && <p className="rounded-lg bg-[#fbfcf8] p-4 text-slate-600">No difficult or need-practice questions yet.</p>}
        {cards.map((card) => (
          <button key={card.id} className="list-item text-left" onClick={() => selectCard(questions.findIndex((item) => item.id === card.id), "practice")}>
            <span className="text-sm font-semibold text-clay">Flashcard {questions.findIndex((item) => item.id === card.id) + 1}</span>
            <span className="mt-1 block font-bold">{card.question}</span>
            <span className="mt-2 block text-sm text-slate-600">
              {progress[card.id].confidence} - {progress[card.id].status === "practice" ? "Need practice" : "Review"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ToolsView(props) {
  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <div className="control-card sm:p-5">
        <h2 className="panel-heading text-xl">📋 Create Questions with ChatGPT</h2>
        <p className="mt-3 leading-relaxed text-slate-700">
          Paste your speaking notes into ChatGPT and ask it to create a JSON array with 20 flashcard questions and answers. Then copy the JSON and paste it into this app to add your questions.
        </p>
        <button className="wide-action mt-4" onClick={() => props.setPromptOpen(!props.promptOpen)}>
          <Clipboard size={18} /> Copy ChatGPT Prompt
        </button>
        {props.promptOpen && (
          <div className="mt-4 rounded-3xl border border-blue-100 bg-blue-50/70 p-3">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{chatGptPrompt}</pre>
            <button className="primary-button mt-3" onClick={props.copyPrompt}>
              {props.copied === "prompt" ? "Prompt Copied" : "Copy Prompt"}
            </button>
          </div>
        )}
      </div>

      <div className="control-card sm:p-5">
        <h2 className="panel-heading text-xl">📥 Import Questions from JSON</h2>
        <p className="mt-3 rounded-2xl bg-gradient-to-r from-blue-50 to-teal-50 px-4 py-3 text-sm font-semibold text-slate-800">
          After importing your own questions, these demo questions can be replaced or kept. Choose "Replace all questions" if you want to remove the demo cards.
        </p>
        <textarea
          className="text-area mt-3 min-h-56"
          placeholder='[{"question":"Tell me about your study goal.","answer":"My goal is to practise speaking clearly every day..."}]'
          value={props.jsonText}
          onChange={(event) => props.setJsonText(event.target.value)}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="option-box">
            <input type="radio" checked={props.importMode === "add"} onChange={() => props.setImportMode("add")} />
            Add to existing questions
          </label>
          <label className="option-box">
            <input type="radio" checked={props.importMode === "replace"} onChange={() => props.setImportMode("replace")} />
            Replace all questions
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <PrimaryButton onClick={props.importQuestions}>📥 Import Questions</PrimaryButton>
          <SecondaryButton onClick={() => props.setJsonText("")}>Clear JSON Box</SecondaryButton>
          <SecondaryButton onClick={props.loadDemoQuestions}>✨ Load Demo Questions</SecondaryButton>
        </div>
        {props.importMessage && <p className="mt-3 rounded-lg bg-skysoft px-3 py-2 font-semibold">{props.importMessage}</p>}
      </div>

      <div className="control-card sm:p-5 lg:col-span-2">
        <h2 className="panel-heading text-xl">✏️ Edit/Add Question</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <label className="field-label">
            Question
            <textarea className="text-area min-h-32" value={props.newQuestion} onChange={(event) => props.setNewQuestion(event.target.value)} />
          </label>
          <label className="field-label">
            Answer
            <textarea className="text-area min-h-32" value={props.newAnswer} onChange={(event) => props.setNewAnswer(event.target.value)} />
          </label>
        </div>
        <button className="primary-button mt-3" onClick={props.addQuestion}>Add Question</button>
      </div>
    </section>
  );
}

function PreviewMode({ questions, startIndex, progress, questionTime, answerTime, autoSpeak, speak, stopVoice, onExit }) {
  const [index, setIndex] = useState(startIndex);
  const [phase, setPhase] = useState("question");
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const timerRef = useRef(null);
  const current = questions[index];
  const answer = progress[current.id].editedAnswer || current.answer;
  const previewPercent = Math.round(((index + (phase === "answer" ? 1 : 0.45)) / questions.length) * 100);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      window.clearTimeout(timerRef.current);
      stopVoice();
    };
  }, [stopVoice]);

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    if (paused || completed) return undefined;
    if (autoSpeak) speak(phase === "question" ? current.question : answer);
    const delay = (phase === "question" ? questionTime : answerTime) * 1000;
    timerRef.current = window.setTimeout(() => {
      if (phase === "question") {
        setPhase("answer");
      } else if (index < questions.length - 1) {
        setIndex((value) => value + 1);
        setPhase("question");
      } else {
        setCompleted(true);
        stopVoice();
      }
    }, delay);
    return () => window.clearTimeout(timerRef.current);
  }, [answer, answerTime, autoSpeak, completed, current.question, index, paused, phase, questionTime, questions.length, speak, stopVoice]);

  function goPreviewNext() {
    window.clearTimeout(timerRef.current);
    stopVoice();
    if (index < questions.length - 1) {
      setIndex(index + 1);
      setPhase("question");
      setCompleted(false);
    } else {
      setCompleted(true);
    }
  }

  function goPreviewPrevious() {
    window.clearTimeout(timerRef.current);
    stopVoice();
    setIndex(Math.max(0, index - 1));
    setPhase("question");
    setCompleted(false);
  }

  if (completed) {
    return (
      <div className="preview-screen">
        <div className="preview-card text-center">
          <p className="text-6xl">🎉</p>
          <p className="mt-4 text-3xl font-black sm:text-5xl">Well done! You completed the practice session.</p>
          <p className="mt-4 text-xl text-white/80">Preview completed.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button className="preview-button" onClick={() => { setIndex(0); setPhase("question"); setCompleted(false); setPaused(false); }}>
              Run Again
            </button>
            <button className="preview-button secondary" onClick={() => onExit(index)}>Exit Preview</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-screen">
      <div className="preview-topbar">
        <span>🎯 QuizMate Preview</span>
        <span>Question {index + 1} of {questions.length}</span>
        <button className="preview-exit" onClick={() => onExit(index)}>Exit Preview</button>
      </div>
      <div className="preview-progress">
        <div className="preview-progress-fill" style={{ width: `${previewPercent}%` }} />
      </div>
      <div className="preview-card">
        <div className="inline-flex w-fit rounded-full bg-white/15 px-4 py-2 text-sm font-black uppercase tracking-wide text-white">
          {phase === "question" ? `Question - ${questionTime}s` : `Answer - ${answerTime}s`}
        </div>
        <h2 className="animate-in mt-6 text-3xl font-black leading-tight sm:text-5xl">{current.question}</h2>
        {phase === "answer" && <p className="animate-in answer-preview mt-8 text-2xl leading-relaxed sm:text-4xl">{answer}</p>}
      </div>
      <div className="preview-controls">
        <button className="preview-icon" onClick={goPreviewPrevious} title="Previous Preview Question"><SkipBack /></button>
        {paused ? (
          <button className="preview-icon" onClick={() => setPaused(false)} title="Resume Preview"><Play /></button>
        ) : (
          <button className="preview-icon" onClick={() => { setPaused(true); stopVoice(); }} title="Pause Preview"><Pause /></button>
        )}
        <button className="preview-icon" onClick={goPreviewNext} title="Next Preview Question"><SkipForward /></button>
        <button className="preview-icon" onClick={stopVoice} title="Stop Voice"><Square /></button>
      </div>
    </div>
  );
}

function PrintSheet({ questions, progress }) {
  return (
    <section className="hidden print:block">
      <h1>QuizMate Practice Sheet</h1>
      {questions.map((card, index) => (
        <article key={card.id} className="print-card">
          <h2>
            {index + 1}. {card.question}
          </h2>
          <p>{progress[card.id].editedAnswer || card.answer}</p>
        </article>
      ))}
    </section>
  );
}

function PrimaryButton({ children, onClick }) {
  return (
    <button className="primary-button" onClick={onClick}>
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }) {
  return (
    <button className="secondary-button" onClick={onClick}>
      {children}
    </button>
  );
}
