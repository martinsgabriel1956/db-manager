import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Opens a tree row's "⋯" menu and picks an action ("Editar conexão", "Nova query SQL"…). */
export async function rowAction(
  user: ReturnType<typeof userEvent.setup>,
  row: string,
  action: string
) {
  // the "⋯" is the mouse's copy of the row's Shift+F10 menu: hidden from the accessibility tree
  await user.click(await screen.findByLabelText(`Ações de ${row}`, { selector: "button" }));
  await user.click(await screen.findByRole("menuitem", { name: action }));
}
