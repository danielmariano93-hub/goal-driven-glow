import { useState } from "react";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useProjectNoteAdd, useProjectNoteDelete, useProjectNotes, useProjectSummarySet, useSummarizeBook, type HabitView } from "@/lib/habits/api";
import { bulletsToText, notesOf, NOTE_MAX, textToBullets, type ReadingNote } from "@/lib/habits/engine/reading";
import type { HbProject } from "@/lib/habits/api";

const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH[Number(iso.slice(5, 7)) - 1]}`;
const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

const Shell = ({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label={title}>
    <div className="flex items-center justify-between gap-3"><h2 className="min-w-0 truncate text-[12px] font-medium text-muted-foreground">{title}</h2>{tag ? <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">{tag}</span> : null}</div>
    {children}
  </section>
);

/** Texto da anotação em blocos: cada parágrafo (separado por linha em branco) vira um bloco; num bloco de várias linhas, a primeira (curta) é o título. */
export function NoteBody({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length > 0);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((lines, i) => (lines.length > 1 && lines[0].length <= 80
        ? (
          <div key={i}>
            <p className="text-[14px] font-medium leading-5">{lines[0]}</p>
            {lines.slice(1).map((l, j) => <p key={j} className="mt-0.5 text-[14px] leading-[22px] text-muted-foreground">{l}</p>)}
          </div>
        )
        : <div key={i}>{lines.map((l, j) => <p key={j} className="text-[14px] leading-[22px]">{l}</p>)}</div>))}
    </div>
  );
}

const isLong = (t: string) => t.length > 220 || t.split("\n").length > 4;
const firstLine = (t: string) => t.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/** Uma anotação: recolhida mostra só o começo; "Ler mais" abre o texto inteiro. */
function NoteItem({ note, isPages, onDelete, deleting }: { note: ReadingNote; isPages: boolean; onDelete: () => void; deleting: boolean }) {
  const [full, setFull] = useState(false);
  const long = isLong(note.body);
  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground tabular-nums">{dm(note.noted_on)}{note.page != null ? ` · ${isPages ? "p. " : ""}${num(note.page)}` : ""}</p>
        <button type="button" aria-label="Apagar anotação" disabled={deleting} onClick={onDelete} className="-mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground/60 active:scale-95"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className={cn("relative mt-1 overflow-hidden transition-[max-height] duration-300", long && !full ? "max-h-[6.75rem]" : "max-h-[200rem]")}>
        <NoteBody text={note.body} />
        {long && !full ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" aria-hidden="true" /> : null}
      </div>
      {long ? <button type="button" aria-expanded={full} onClick={() => setFull((v) => !v)} className="mt-1 h-8 text-[13px] font-medium text-primary">{full ? "Mostrar menos" : "Ler mais"}</button> : null}
    </li>
  );
}

/** Anotações do livro em andamento: um acordeão (recolhido mostra só uma prévia), com "Anotar agora". */
function OpenBookNotes({ project, notes, today }: { project: HbProject; notes: ReadingNote[]; today: string }) {
  const add = useProjectNoteAdd();
  const del = useProjectNoteDelete();
  const [open, setOpen] = useState(notes.length === 0);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const isPages = (project.unit ?? "").toLowerCase().startsWith("pág");
  const latest = notes[0];
  const save = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await add.mutateAsync({ project_id: project.id, body, page: project.current > 0 ? project.current : null, date: today });
      setText(""); setWriting(false); setOpen(true); toast.success("Anotado");
    } catch (e) { toast.error(hbErrorMessage(e)); }
  };
  return (
    <section className="rounded-2xl border border-border/60 bg-card shadow-card" aria-label="O que você anotou">
      <button type="button" aria-expanded={open} aria-controls="anotacoes-do-livro" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-4 text-left">
        <div className="min-w-0 flex-1">
          <h2 className="text-[12px] font-medium text-muted-foreground">O que você anotou</h2>
          {!open && latest ? <p className="mt-1 truncate text-[14px] leading-5">{firstLine(latest.body)}</p> : null}
          {!open && latest ? <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">{dm(latest.noted_on)}{latest.page != null ? ` · ${isPages ? "p. " : ""}${num(latest.page)}` : ""}</p> : null}
        </div>
        {notes.length ? <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">{notes.length}</span> : null}
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id="anotacoes-do-livro" className={cn("grid transition-[grid-template-rows] duration-300", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className={cn("px-4 pb-4 transition-[visibility] duration-300", !open && "invisible")}>
            {notes.length === 0 && !writing ? <p className="text-[13px] leading-5 text-muted-foreground">Ainda sem anotações. Ao registrar a leitura, escreva em uma frase o que ficou: isso ajuda a lembrar depois.</p> : null}
            {notes.length > 0 ? (
              <ul className="divide-y divide-border/60">
                {notes.map((n) => <NoteItem key={n.id} note={n} isPages={isPages} deleting={del.isPending} onDelete={() => del.mutate(n.id, { onError: (e) => toast.error(hbErrorMessage(e)) })} />)}
              </ul>
            ) : null}
            {writing ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX))} rows={4} maxLength={NOTE_MAX} autoFocus placeholder="O que você absorveu até aqui?" aria-label="Nova anotação" className="max-h-60 w-full resize-y overflow-y-auto rounded-xl border border-border/70 bg-background px-3.5 py-2.5 text-[14px] leading-5 outline-none focus:border-primary" />
                {text.length > NOTE_MAX * 0.8 ? <span className="text-right text-[11px] text-muted-foreground tabular-nums" aria-live="polite">{text.length} de {NOTE_MAX}</span> : null}
                <div className="flex gap-2">
                  <Button className="h-10 flex-1 rounded-full" disabled={add.isPending || text.trim().length === 0} onClick={() => void save()}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Guardar"}</Button>
                  <Button variant="outline" className="h-10 rounded-full" onClick={() => { setWriting(false); setText(""); }}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setWriting(true)} className="mt-3 h-10 w-full rounded-full border border-border bg-background text-[14px] font-medium text-primary active:scale-[0.99]">+ Anotar agora</button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Livro concluído: resumo em tópicos feito só das anotações da pessoa, editável. */
function FinishedBook({ project, notes, saved }: { project: HbProject; notes: ReadingNote[]; saved: string | null }) {
  const summarize = useSummarizeBook();
  const setSummary = useProjectSummarySet();
  const [draft, setDraft] = useState<string | null>(null);
  const [origin, setOrigin] = useState<"ai" | "template" | null>(null);
  const [editing, setEditing] = useState(false);
  const bullets = textToBullets(saved ?? "");

  const generate = async () => {
    try {
      const r = await summarize.mutateAsync(project.id);
      if (!r.bullets?.length) return toast.error("Ainda não deu para resumir. Tente de novo em instantes.");
      setDraft(bulletsToText(r.bullets)); setOrigin(r.source === "ai" ? "ai" : "template"); setEditing(true);
    } catch (e) { toast.error(hbErrorMessage(e)); }
  };
  const save = async () => {
    const text = bulletsToText(textToBullets(draft ?? ""));
    try {
      await setSummary.mutateAsync({ project_id: project.id, summary: text });
      setEditing(false); setDraft(null); setOrigin(null); toast.success("Resumo guardado");
    } catch (e) { toast.error(hbErrorMessage(e)); }
  };

  return (
    <Shell title={project.title} tag={`${notes.length} ${notes.length === 1 ? "anotação" : "anotações"}`}>
      <p className="mt-1 text-[12px] text-muted-foreground">Concluído{project.finished_on ? ` em ${dm(project.finished_on)}` : ""}</p>
      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <span className="w-fit rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary">feito das suas anotações</span>
          <textarea value={draft ?? ""} onChange={(e) => setDraft(e.target.value.slice(0, 2000))} rows={Math.min(10, Math.max(4, textToBullets(draft ?? "").length + 1))} aria-label="Resumo do livro" className="w-full resize-none rounded-xl border border-border/70 bg-background px-3.5 py-2.5 text-[14px] leading-5 outline-none focus:border-primary" />
          <p className="text-[12px] leading-5 text-muted-foreground">{origin === "template" ? "Sem a IA agora: usei a primeira frase de cada anotação. Edite como preferir." : "Só organizei o que você escreveu, sem acrescentar nada do livro. Edite como preferir."}</p>
          <div className="flex gap-2">
            <Button className="h-10 flex-1 rounded-full" disabled={setSummary.isPending || textToBullets(draft ?? "").length === 0} onClick={() => void save()}>{setSummary.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Guardar"}</Button>
            <Button variant="outline" className="h-10 rounded-full" onClick={() => { setEditing(false); setDraft(null); setOrigin(null); }}>Cancelar</Button>
          </div>
        </div>
      ) : bullets.length > 0 ? (
        <>
          <span className="mt-3 inline-block rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary">feito das suas anotações</span>
          <ul className="mt-2 flex flex-col gap-1.5">{bullets.map((b, i) => <li key={i} className="flex gap-2 text-[14px] leading-5"><i className="mt-2 block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /><span>{b}</span></li>)}</ul>
          <button type="button" onClick={() => { setDraft(bulletsToText(bullets)); setOrigin(null); setEditing(true); }} className="mt-3 h-9 text-[14px] font-medium text-primary">Editar</button>
        </>
      ) : (
        <Button variant="outline" className="mt-3 h-10 w-full rounded-full" disabled={summarize.isPending} onClick={() => void generate()}>{summarize.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Resumir minhas anotações"}</Button>
      )}
    </Shell>
  );
}

/** Anotações de leitura de um hábito em forma de projeto (livro): o atual e os concluídos que têm anotações. */
export function ReadingNotes({ view, today }: { view: HabitView; today: string }) {
  const q = useProjectNotes(view.habit.id, view.form === "project");
  if (view.form !== "project" || (view.project?.unit ?? "") === "R$" || !q.data) return null;
  const { notes, summaries } = q.data;
  const finished = view.projects_done.filter((p) => notes.some((n) => n.project_id === p.id));
  if (!view.project && finished.length === 0) return null;
  return (
    <>
      {view.project ? <OpenBookNotes project={view.project} notes={notesOf(notes, view.project.id)} today={today} /> : null}
      {finished.map((p) => <FinishedBook key={p.id} project={p} notes={notesOf(notes, p.id)} saved={summaries.find((s) => s.project_id === p.id)?.summary ?? null} />)}
    </>
  );
}
