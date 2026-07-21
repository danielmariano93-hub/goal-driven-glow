import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type Column } from "@/components/admin/DataTable";

type Row = { id: string; name: string; email: string; secret: string };

const rows: Row[] = [
  { id: "1", name: "Ana", email: "ana@x.com", secret: "s1" },
  { id: "2", name: "Bob", email: "bob@x.com", secret: "s2" },
];

const cols: Column<Row>[] = [
  { key: "name", header: "Nome", cell: (r) => r.name },
  { key: "email", header: "E-mail", cell: (r) => r.email },
  { key: "secret", header: "Secreto", cell: (r) => r.secret, hideOnMobile: true },
];

describe("DataTable", () => {
  it("renderiza tabela desktop com todas as colunas e todas as linhas", () => {
    render(<DataTable rows={rows} columns={cols} rowKey={(r) => r.id} ariaLabel="Teste" />);
    expect(screen.getByRole("table", { name: "Teste" })).toBeInTheDocument();
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nome").length).toBeGreaterThan(0);
  });

  it("também renderiza cards mobile (elementos ocultos por CSS mas presentes no DOM)", () => {
    render(<DataTable rows={rows} columns={cols} rowKey={(r) => r.id} />);
    // Cada linha aparece duas vezes (tabela + card mobile), exceto colunas escondidas no mobile.
    expect(screen.getAllByText("ana@x.com").length).toBe(2);
    // Coluna "Secreto" só aparece na tabela desktop.
    expect(screen.getAllByText("s1").length).toBe(1);
  });
});
