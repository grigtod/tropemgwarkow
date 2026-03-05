import json
import os
import queue
import re
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from tkinter import END, BOTH, LEFT, RIGHT, TOP, X, Y, filedialog, messagebox, StringVar
import tkinter as tk
from tkinter import ttk


DEFAULT_VOICE_ID = ""
DEFAULT_MODEL_ID = "eleven_multilingual_v2"


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "node"


def parse_elevenlabs_error(body: str):
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None, None

    detail = payload.get("detail")
    if isinstance(detail, dict):
        return detail.get("status"), detail.get("message")
    return None, None


def elevenlabs_tts(api_key: str, voice_id: str, text: str, model_id: str) -> bytes:
    payload = json.dumps(
        {
            "text": text,
            "model_id": model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        url=f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        data=payload,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        status, message = parse_elevenlabs_error(body)
        if status == "free_users_not_allowed":
            raise RuntimeError(
                "Selected voice is not available on your ElevenLabs plan. "
                "Pick a voice from your account (Voice Library / My Voices) and paste its Voice ID."
            ) from exc
        if message:
            raise RuntimeError(f"HTTP {exc.code}: {message}") from exc
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc


def process_dialogue_tree(
    api_key: str,
    voice_id: str,
    model_id: str,
    json_path: Path,
    output_dir: Path,
    log,
):
    with json_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError("Dialogue tree JSON must be an object/dictionary at root.")

    output_dir.mkdir(parents=True, exist_ok=True)
    generated = 0

    for node_name, node in data.items():
        if not isinstance(node, dict):
            continue

        text = node.get("text")
        if not isinstance(text, str) or not text.strip():
            continue

        node_uuid = str(uuid.uuid4())
        safe_node = slugify(str(node_name))
        filename = f"{safe_node}_{node_uuid}.mp3"
        filepath = output_dir / filename

        log(f"Generating: {node_name}")
        audio_bytes = elevenlabs_tts(api_key, voice_id, text.strip(), model_id)

        with filepath.open("wb") as audio_file:
            audio_file.write(audio_bytes)

        node["uuid"] = node_uuid
        node["audio_file"] = filename
        generated += 1

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return generated


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Dialogue Tree -> ElevenLabs Audio")
        self.geometry("860x520")

        self.api_key = StringVar()
        self.voice_id = StringVar(value=DEFAULT_VOICE_ID)
        self.model_id = StringVar(value=DEFAULT_MODEL_ID)
        self.json_path = StringVar()
        self.output_dir = StringVar()

        self.log_queue = queue.Queue()

        self._build_ui()
        self.after(100, self._drain_log_queue)

    def _build_ui(self):
        root = ttk.Frame(self, padding=12)
        root.pack(fill=BOTH, expand=True)

        self._add_labeled_entry(root, "ElevenLabs API Key", self.api_key, show="*")
        self._add_labeled_entry(root, "Voice ID", self.voice_id)
        self._add_labeled_entry(root, "Model ID", self.model_id)

        file_row = ttk.Frame(root)
        file_row.pack(fill=X, pady=6)
        ttk.Label(file_row, text="Dialogue JSON", width=18).pack(side=LEFT)
        ttk.Entry(file_row, textvariable=self.json_path).pack(side=LEFT, fill=X, expand=True, padx=(0, 8))
        ttk.Button(file_row, text="Browse", command=self._browse_json).pack(side=LEFT)

        out_row = ttk.Frame(root)
        out_row.pack(fill=X, pady=6)
        ttk.Label(out_row, text="Output folder", width=18).pack(side=LEFT)
        ttk.Entry(out_row, textvariable=self.output_dir).pack(side=LEFT, fill=X, expand=True, padx=(0, 8))
        ttk.Button(out_row, text="Browse", command=self._browse_output).pack(side=LEFT)

        controls = ttk.Frame(root)
        controls.pack(fill=X, pady=(10, 8))
        self.generate_btn = ttk.Button(controls, text="Generate Audio + Update JSON", command=self._on_generate)
        self.generate_btn.pack(side=LEFT)

        self.log_text = tk.Text(root, height=18, wrap="word")
        self.log_text.pack(fill=BOTH, expand=True, pady=(6, 0))

    def _add_labeled_entry(self, parent, label, variable, show=None):
        row = ttk.Frame(parent)
        row.pack(fill=X, pady=6)
        ttk.Label(row, text=label, width=18).pack(side=LEFT)
        ttk.Entry(row, textvariable=variable, show=show).pack(side=LEFT, fill=X, expand=True)

    def _browse_json(self):
        path = filedialog.askopenfilename(filetypes=[("JSON files", "*.json"), ("All files", "*.*")])
        if path:
            self.json_path.set(path)
            if not self.output_dir.get().strip():
                base = Path(path).resolve().parent / "audio"
                self.output_dir.set(str(base))

    def _browse_output(self):
        path = filedialog.askdirectory()
        if path:
            self.output_dir.set(path)

    def _log(self, message: str):
        self.log_queue.put(message)

    def _drain_log_queue(self):
        while True:
            try:
                message = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self.log_text.insert(END, message + "\n")
            self.log_text.see(END)
        self.after(100, self._drain_log_queue)

    def _set_generating(self, generating: bool):
        self.generate_btn.configure(state="disabled" if generating else "normal")

    def _on_generate(self):
        api_key = self.api_key.get().strip()
        voice_id = self.voice_id.get().strip()
        model_id = self.model_id.get().strip()
        json_path_str = self.json_path.get().strip()
        output_dir_str = self.output_dir.get().strip()

        if not api_key:
            messagebox.showerror("Missing API key", "Please enter your ElevenLabs API key.")
            return
        if not voice_id:
            messagebox.showerror(
                "Missing voice ID",
                "Please enter a voice ID from your ElevenLabs account (Voice Library / My Voices).",
            )
            return
        if not json_path_str:
            messagebox.showerror("Missing JSON file", "Please choose a dialogue JSON file.")
            return

        json_path = Path(json_path_str)
        if not json_path.exists():
            messagebox.showerror("Invalid file", "Selected JSON file does not exist.")
            return

        output_dir = Path(output_dir_str) if output_dir_str else json_path.parent / "audio"
        self.output_dir.set(str(output_dir))

        self._set_generating(True)
        self._log("Starting generation...")

        thread = threading.Thread(
            target=self._run_generation,
            args=(api_key, voice_id, model_id, json_path, output_dir),
            daemon=True,
        )
        thread.start()

    def _run_generation(self, api_key, voice_id, model_id, json_path, output_dir):
        try:
            generated = process_dialogue_tree(
                api_key=api_key,
                voice_id=voice_id,
                model_id=model_id,
                json_path=json_path,
                output_dir=output_dir,
                log=self._log,
            )
            self._log(f"Done. Generated {generated} audio file(s).")
            self.after(0, lambda: messagebox.showinfo("Success", f"Generated {generated} audio file(s)."))
        except Exception as exc:
            self._log(f"Error: {exc}")
            self.after(0, lambda: messagebox.showerror("Generation failed", str(exc)))
        finally:
            self.after(0, lambda: self._set_generating(False))


if __name__ == "__main__":
    app = App()
    app.mainloop()
