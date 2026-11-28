"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { askClasses } from "@/lib/ask-client";
import type { AskResponse, AskSource } from "@/lib/ask-client";
import styles from "./ask-my-classes.module.css";

export const EXAMPLE_QUESTIONS = [
  "When is my next assignment due?",
  "What should I know about late submissions?",
  "What are my instructor's office hours?",
] as const;

type AnswerState = {
  question: string;
  response: AskResponse;
};

function sourceTitle(source: AskSource): string {
  if ("fileName" in source.source && typeof source.source.fileName === "string") {
    return source.source.fileName;
  }
  if ("title" in source.source && typeof source.source.title === "string") {
    return source.source.title;
  }
  return source.kind === "class-details" ? "Class details" : "Course information";
}

export function AskMyClasses() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(questionToAsk: string) {
    const trimmed = questionToAsk.trim();
    if (!trimmed || loading) {
      return;
    }

    setQuestion(trimmed);
    setError(null);
    setAnswer(null);
    setLoading(true);
    const result = await askClasses(trimmed);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAnswer({ question: trimmed, response: result.data });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <section className={styles.panel} aria-labelledby="ask-my-classes-heading">
      <div>
        <h2 className={styles.heading} id="ask-my-classes-heading">Ask my classes</h2>
        <p className={styles.description}>
          Get answers from your saved syllabi, assignments, and class details.
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <Input
          label="Your question"
          value={question}
          maxLength={500}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about your coursework"
          disabled={loading}
        />
        <Button type="submit" className={styles.submit} loading={loading} disabled={!question.trim()}>
          Ask
        </Button>
      </form>

      <div className={styles.examples} role="group" aria-label="Example questions">
        {EXAMPLE_QUESTIONS.map((example) => (
          <button
            type="button"
            className={styles.example}
            key={example}
            disabled={loading}
            onClick={() => void ask(example)}
          >
            {example}
          </button>
        ))}
      </div>

      {loading ? <p className={styles.status} role="status">Looking through your classes…</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {answer ? (
        <div className={styles.answer} aria-live="polite">
          <p className={styles.question}>You asked: {answer.question}</p>
          {answer.response.found ? (
            <>
              <h3 className={styles.answerTitle}>Answer</h3>
              <p className={styles.answerText}>{answer.response.answer}</p>
              <div className={styles.sources}>
                {answer.response.sources.map((source, index) => (
                  <blockquote className={styles.source} key={`${source.courseId}-${index}`}>
                    <span className={styles.sourceTitle}>
                      {source.courseName} · {sourceTitle(source)}
                    </span>
                    <span>{source.quote}</span>
                  </blockquote>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.notFound} role="status">{answer.response.message}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
