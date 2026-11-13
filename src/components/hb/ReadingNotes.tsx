import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hbErrorMessage, useProjectNoteAdd, useProjectNoteDelete, useProjectNotes, useProjectSummarySet, useSummarizeBook, type HabitView } from "@/lib/habits/api";
import { bulletsToText, notesOf, textToBullets, type ReadingNote } from "@/lib/habits/engine/reading";
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

/** Linha do tempo das anotações do livro em andamento, com "Anotar agora". */
function OpenBookNotes({ project, notes, today }: { project: HbProject; notes: ReadingNote[]; today: string }) {
  const add = useProjectNoteAdd();
  const del = useProjectNoteDelete();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const isPages = (project.unit ?? "").toLowerCase().startsWith("pág");
  const save = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await add.mutateAsync({ project_id: project.id, body, page: project.current > 0 ? project.current : null, date: today });
      setText(""); setWriting(false); toast.success("Anotado");
    } catch (e) { toast.error(hbErrorMessage(e)); }
  };
  return (
    <Shell title="O que você anotou" tag={notes.length ? String(notes.length) : undefined}>
      {notes.length === 0 && !writing ? <p className="mt-2 text-[13px] leading-5 text-muted-foreground">Ainda sem anotações. Ao registrar a leitura, escreva em uma frase o que ficou: isso ajuda a lembrar depois.</p> : null}
      {notes.length > 0 ? (
        <ul className="mt-2 divide-y divide-border/60">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 py-2.5 first:pt-1">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">{dm(n.noted_on)}{n.page != null ? ` · ${isPages ? "p. " : ""}${num(n.page)}` : ""}</p>
                <p className="mt-0.5 whitespace-pre-line text-[14px] leading-5">{n.body}</p>
              </div>
              <button type="button" aria-label="Apagar anotação" disabled={del.isPending} onClick={() => del.mutate(n.id, { onError: (e) => toast.error(hbErrorMessage(e)) })} className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground/70 active:scale-95"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {writing ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} rows={3} maxLength={500} autoFocus placeholder="O que você absorveu até aqui?" aria-label="Nova anotação" className="w-full resize-none rounded-xl border border-border/70 bg-background px-3.5 py-2.5 text-[14px] leading-5 outline-none focus:border-primary" />
          <div className="flex gap-2">
            <Button className="h-10 flex-1 rounded-full" disabled={add.isPending || text.trim().length === 0} onClick={() => void save()}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Guardar"}</Button>
            <Button variant="outline" className="h-10 rounded-full" onClick={() => { setWriting(false); setText(""); }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setWriting(true)} className="mt-3 h-10 w-full rounded-full border border-border bg-background text-[14px] font-medium text-primary active:scale-[0.99]">+ Anotar agora</button>
      )}
    </Shell>
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
