import { createSignal, untrack } from "solid-js";

interface TextEditIntent {
  id: string;
  caret: "end" | { clientX: number; clientY: number };
}

interface TextEditingSession {
  commit: () => void;
  changeFontSize: (delta: number) => void;
}

/** One controller per activation. No editor state survives unloading a plugin. */
export function createTextEditing() {
  const [intent, setIntent] = createSignal<TextEditIntent | null>(null);
  const sessions = new Map<string, TextEditingSession>();
  return {
    intent,
    begin(id: string, caret: TextEditIntent["caret"] = "end") {
      if (untrack(intent)?.id === id) return;
      setIntent({ id, caret });
    },
    end(id?: string) {
      if (id === undefined || untrack(intent)?.id === id) setIntent(null);
    },
    active(id: string) {
      return intent()?.id === id;
    },
    register(id: string, session: TextEditingSession) {
      sessions.set(id, session);
      return () => {
        if (sessions.get(id) === session) sessions.delete(id);
      };
    },
    commit() {
      const id = intent()?.id;
      if (id !== undefined) sessions.get(id)?.commit();
    },
    changeFontSize(delta: number) {
      const id = intent()?.id;
      const session = id === undefined ? undefined : sessions.get(id);
      if (session === undefined) return false;
      session.changeFontSize(delta);
      return true;
    },
  };
}

export type TextEditing = ReturnType<typeof createTextEditing>;
