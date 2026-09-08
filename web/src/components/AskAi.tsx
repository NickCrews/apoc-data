/**
 * Questions the dashboard can't answer.
 *
 * Rather than teaching a non-technical reader SQL, this hands them a prompt
 * with the whole schema already filled in, ready to paste into whatever AI
 * tool they already use. Whatever query comes back can be run in the SQL
 * editor here, or in duckdb anywhere else.
 *
 * How the AI gets at the data decides whether any of this works: ChatGPT and
 * Gemini have no arbitrary web access, so a prompt pointing at parquet URLs
 * fails there no matter how good the schema is. Nobody knows off the top of
 * their head which tools can fetch a URL, and it isn't a fair thing to ask, so
 * the prompt puts the question to the AI itself -- which does know -- and
 * tells it to send you back here for the zip when the answer is no.
 *
 * It lives in a badge hovering over the bottom-left corner rather than in a
 * panel of its own: it's a side door off the dashboard, not a place to spend
 * time, so it shouldn't cost the dashboard any width until someone opens it.
 */

import { Button, Textarea, cn } from '@sqlrooms/ui';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FC } from 'react';
import { buildPrompt } from '../aiGuide';
import { CSV_ZIP_FILE, csvUrl } from '../config';
import { formatBytes, useManifest, type Manifest } from '../manifest';

const EXAMPLE_QUESTIONS = [
  'Who were the ten biggest donors to candidates for Governor in 2022?',
  'Which industries and employers give the most to Anchorage Assembly candidates?',
  'How much did each mayoral candidate raise from donors outside Alaska?',
  'What did campaigns spend the most money on in the last election?',
  'Which PACs gave to both Republican and Democratic candidates?',
  'How has the average contribution size changed since 2010?',
];

export const AskAiBadge: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  // Held out here rather than in the card so collapsing the badge doesn't
  // throw away a half-written question.
  const [question, setQuestion] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  return (
    // The wrapper spans only what it contains and lets clicks through
    // everywhere else, so the dashboard underneath stays fully usable while
    // the card is open.
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col items-start gap-2">
      {isOpen ? (
        <AskAiCard
          question={question}
          onQuestionChange={setQuestion}
          onClose={() => setIsOpen(false)}
        />
      ) : null}

      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          'pointer-events-auto flex items-center gap-2 rounded-full border py-2 pr-4 pl-3 text-sm font-medium shadow-lg transition-colors',
          isOpen
            ? 'bg-muted text-foreground hover:bg-muted/80'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 border-transparent',
        )}
      >
        {isOpen ? (
          <XIcon className="h-4 w-4" />
        ) : (
          <SparklesIcon className="h-4 w-4" />
        )}
        {isOpen ? 'Close' : 'Ask an AI'}
      </button>
    </div>
  );
};

const AskAiCard: FC<{
  question: string;
  onQuestionChange: (question: string) => void;
  onClose: () => void;
}> = ({ question, onQuestionChange, onClose }) => {
  const { manifest, error } = useManifest();
  const [copied, setCopied] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  const copy = async () => {
    if (!manifest) return;
    await navigator.clipboard.writeText(buildPrompt(manifest, question));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-label="Ask an AI"
      className="apoc-ai-card bg-background text-foreground pointer-events-auto flex max-h-[min(34rem,calc(100vh-8rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <SparklesIcon className="text-primary h-4 w-4" />
        <span className="text-sm font-medium">Ask an AI</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground hover:bg-muted ml-auto rounded p-1"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3 overflow-auto p-3">
        <p className="text-muted-foreground text-xs">
          Want an answer this dashboard doesn't give you? Write your question
          below and paste the pre-filled prompt into Claude or ChatGPT
          (Gemini, as of September 2026 can't run the code needed to do the analysis).
        </p>

        <Textarea
          ref={questionRef}
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder="Who gave the most money to candidates for Anchorage mayor?"
          rows={4}
          className="text-sm"
        />

        <Button onClick={copy} disabled={!manifest}>
          {copied ? (
            <CheckIcon className="h-4 w-4" />
          ) : (
            <CopyIcon className="h-4 w-4" />
          )}
          {copied ? 'Copied — now paste it into your AI tool' : 'Copy prompt'}
        </Button>

        <CsvZipCallout manifest={manifest} />

        {error ? (
          <p className="text-destructive text-xs">{error.message}</p>
        ) : null}

        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            Or start from one of these
          </p>
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              onClick={() => onQuestionChange(example)}
              className="hover:bg-muted rounded border px-2 py-1.5 text-left text-xs"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * The zip, kept where the prompt will send someone back to.
 *
 * It sits under the copy button rather than above it, because most of the time
 * it isn't needed: the prompt asks the AI to try the URLs first, and only the
 * tools that can't reach them send you back here for the files.
 */
const CsvZipCallout: FC<{ manifest: Manifest | undefined }> = ({ manifest }) => (
  <div className="bg-muted flex flex-col gap-2 rounded border p-2">
    <p className="text-muted-foreground text-xs">
      If your AI can't reach the internet — ChatGPT and Gemini usually can't —
      it will say so and ask for the data. Download it here and attach it to
      the chat.
    </p>
    <CsvZipButton manifest={manifest} />
  </div>
);

/**
 * One archive of every CSV. The download menu on a file's page offers the same
 * file, but as a menu item rather than a button, so it links to it directly.
 */
const CsvZipButton: FC<{ manifest: Manifest | undefined }> = ({ manifest }) => {
  const zip = manifest?.csv_zip;
  const size = zip ? formatBytes(zip.bytes) : '';
  return (
    <Button asChild size="sm">
      <a href={csvUrl(zip?.file ?? CSV_ZIP_FILE)} download>
        <DownloadIcon className="h-3.5 w-3.5" />
        <span className="flex-1">All CSVs (.zip)</span>
        {size ? <span className="text-xs opacity-70">{size}</span> : null}
      </a>
    </Button>
  );
};
