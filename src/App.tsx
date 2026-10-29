import { useEffect, useState } from "react";
import { call } from "./api";
import Settings from "./Settings";

export default function App() {
  const [openSettings, setOpenSettings] = useState(false);
  const [health, setHealth] = useState("checking...");
  const [role, setRole] = useState("Author");
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [bpFile, setBpFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  useEffect(() => {
    call<{ status: string }>("/health")
      .then((d) => setHealth(d.status))
      .catch(() => setHealth("server not reachable"));
  }, []);

  const handleGenerate = async () => {
    if (!specFile) {
      setError("Please select a Course Specification file.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("spec", specFile);
      if (bpFile) formData.append("blueprint", bpFile);

      const data = await call<{ output: any; html: string }>("/generate", {
        method: "POST",
        body: formData,
      });

      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const downloadJson = () => {
    if (!result?.output) return;
    const blob = new Blob([JSON.stringify(result.output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "specforge_output.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadHtml = () => {
    if (!result?.html) return;
    const blob = new Blob([result.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spec.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  const bloomsColor = (lvl: number) => {
    switch (lvl) {
      case 1: return "#64748b";
      case 2: return "#0284c7";
      case 3: return "#059669";
      case 4: return "#d97706";
      case 5: return "#ea580c";
      case 6: return "#dc2626";
      default: return "#475569";
    }
  };

  return (
    <>
      <header className="bar">
        <h1>SpecForge - Course Specification Builder</h1>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <span>Role:</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: "4px 8px" }}>
            <option value="Author">Author</option>
            <option value="Reviewer">Reviewer</option>
            <option value="HOD">HOD</option>
          </select>
        </label>
        <span className="pill">Server: {health}</span>
        <button className="ghost" onClick={() => setOpenSettings(true)} aria-label="Settings">
          ⚙️ Settings
        </button>
      </header>

      <main style={{ display: "grid", gap: 24 }}>
        {/* Upload Card */}
        <section style={{ border: "1px solid #8884", borderRadius: 8, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Input Files</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ border: "1px dashed #8886", padding: 16, borderRadius: 6 }}>
              <strong>Course Specification (Required)</strong>
              <p className="hint">Accepts .docx, .doc, .pdf, .html</p>
              <input
                type="file"
                accept=".docx,.doc,.pdf,.html,.htm"
                onChange={(e) => setSpecFile(e.target.files?.[0] || null)}
                style={{ marginTop: 8 }}
              />
              {specFile && <p style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>Selected: {specFile.name}</p>}
            </div>

            <div style={{ border: "1px dashed #8886", padding: 16, borderRadius: 6 }}>
              <strong>Question-Paper Blueprint (Optional)</strong>
              <p className="hint">Accepts .doc, .docx, .pdf, .html</p>
              <input
                type="file"
                accept=".doc,.docx,.pdf,.html,.htm"
                onChange={(e) => setBpFile(e.target.files?.[0] || null)}
                style={{ marginTop: 8 }}
              />
              {bpFile && <p style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>Selected: {bpFile.name}</p>}
            </div>
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={handleGenerate} disabled={!specFile || loading}>
              {loading ? "Generating..." : "Generate Corrected Spec"}
            </button>
            {error && <span className="bad">{error}</span>}
          </div>
        </section>

        {/* Results Card */}
        {result && (
          <section style={{ border: "1px solid #8884", borderRadius: 8, padding: 20, display: "grid", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  {result.output.course.code}: {result.output.course.title}
                </h2>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <span className="pill">Credits: {result.output.course.credits_ltp}</span>
                  <span className="pill">Type: {result.output.course.course_type}</span>
                  <span className="pill">Template: {result.output.template === "integrated" ? "Integrated (Lab)" : "Non-Lab"}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={downloadJson}>Download JSON</button>
                <button onClick={downloadHtml} style={{ background: "#059669" }}>Download HTML</button>
              </div>
            </div>

            {/* Course Summary */}
            <div>
              <h3>Course Summary</h3>
              <p style={{ lineHeight: 1.6 }}>{result.output.course.summary}</p>
            </div>

            {/* Course Outcomes */}
            <div>
              <h3>Course Outcomes ({result.output.course_outcomes.length})</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {result.output.course_outcomes.map((co: any) => (
                  <div key={co.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: 10, border: "1px solid #8883", borderRadius: 6 }}>
                    <span style={{ fontWeight: "bold", minWidth: 50 }}>{co.id}</span>
                    <span style={{ flex: 1 }}>{co.statement}</span>
                    <span style={{ padding: "2px 8px", borderRadius: 4, color: "#fff", background: bloomsColor(co.bloom_level), fontSize: "0.8rem", fontWeight: "bold" }}>
                      Bloom L{co.bloom_level}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Defects Found */}
            <div>
              <h3>Detected Defects ({result.output.defects.length})</h3>
              {result.output.defects.length === 0 ? (
                <p style={{ color: "#059669" }}>No defects identified.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {result.output.defects.map((d: any, idx: number) => (
                    <div key={idx} style={{ padding: 12, border: "1px solid #f8717144", background: "#fef2f211", borderRadius: 6 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <code style={{ color: "#dc2626", fontWeight: "bold" }}>{d.code}</code>
                        <span className="hint">Source: {d.location.source} {d.location.section ? `(Section ${d.location.section})` : ""}</span>
                        {d.location.refs?.length > 0 && <span className="hint">[{d.location.refs.join(", ")}]</span>}
                      </div>
                      <p style={{ margin: "6px 0 2px" }}>{d.description}</p>
                      <p style={{ margin: 0, fontSize: "0.85rem", color: "#059669" }}><strong>Fix applied:</strong> {d.fix}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {openSettings && <Settings onClose={() => setOpenSettings(false)} />}
    </>
  );
}
