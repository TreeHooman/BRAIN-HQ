// sherpa-onnx keyword spotting for LUTHUR's wake word (owner ask, 2026-10-09: the browser/Windows recognizers woke at
// random and missed the name; Picovoice needed a company email). Runs fully on this PC: no account, no key. Listens on
// the default microphone for the phrases in the keywords file (written by src/lib/wake-engine.ts from the owner's
// wake phrase). On a detection it hands over to the dashboard at once and exits; HQ starts it again later.
// Inputs: HQ_KWS_KEYWORDS (keywords file), HQ_KWS_THRESHOLD, HQ_KWS_SCORE, HQ_PC_VOICE_COOKIE. Library + model: scripts\sherpa.
// --check: load the model only. --check <file.wav>: also run that 16 kHz mono wav through and print what was heard.
// Exit codes: 0 handed over / check ok, 1 microphone or HQ problem, 2 the spotter could not start.
using System;
using System.IO;
using System.Net;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Speech.AudioFormat;
using System.Web.Script.Serialization;
using System.Text.RegularExpressions;

class PcWakeKws {
  const string LIB = "sherpa-onnx-c-api.dll";
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetDllDirectoryW(string dir);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryW(string path);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr w);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr w, System.Text.StringBuilder s, int n);
  /** Is LUTHUR's main window the one in front right now? (owner, 2026-10-09: the page's own "I'm on screen" report
   *  sent wake-ups to a minimized War Room instead of the side panel.) */
  static bool MainInFront() { IntPtr w = GetForegroundWindow(); if (w == IntPtr.Zero || IsIconic(w)) return false; var t = new System.Text.StringBuilder(256); GetWindowTextW(w, t, 256); return t.ToString() == "LUTHUR"; }

  // Mirrors sherpa-onnx v1.13.8 c-api.h (sequential, natural alignment).
  [StructLayout(LayoutKind.Sequential)] struct FeatureConfig { public int sample_rate, feature_dim; }
  [StructLayout(LayoutKind.Sequential)] struct TransducerConfig { [MarshalAs(UnmanagedType.LPStr)] public string encoder, decoder, joiner; }
  [StructLayout(LayoutKind.Sequential)] struct ParaformerConfig { [MarshalAs(UnmanagedType.LPStr)] public string encoder, decoder; }
  [StructLayout(LayoutKind.Sequential)] struct OneModel { [MarshalAs(UnmanagedType.LPStr)] public string model; }
  [StructLayout(LayoutKind.Sequential)] struct OnlineModelConfig {
    public TransducerConfig transducer; public ParaformerConfig paraformer; public OneModel zipformer2_ctc;
    [MarshalAs(UnmanagedType.LPStr)] public string tokens; public int num_threads; [MarshalAs(UnmanagedType.LPStr)] public string provider; public int debug;
    [MarshalAs(UnmanagedType.LPStr)] public string model_type, modeling_unit, bpe_vocab, tokens_buf; public int tokens_buf_size;
    public OneModel nemo_ctc, t_one_ctc;
  }
  [StructLayout(LayoutKind.Sequential)] struct KwsConfig {
    public FeatureConfig feat_config; public OnlineModelConfig model_config; public int max_active_paths, num_trailing_blanks;
    public float keywords_score, keywords_threshold; [MarshalAs(UnmanagedType.LPStr)] public string keywords_file, keywords_buf; public int keywords_buf_size;
  }
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern IntPtr SherpaOnnxCreateKeywordSpotter(ref KwsConfig config);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern void SherpaOnnxDestroyKeywordSpotter(IntPtr spotter);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern IntPtr SherpaOnnxCreateKeywordStream(IntPtr spotter);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern void SherpaOnnxDestroyOnlineStream(IntPtr stream);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern void SherpaOnnxOnlineStreamAcceptWaveform(IntPtr stream, int rate, float[] samples, int n);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern void SherpaOnnxOnlineStreamInputFinished(IntPtr stream);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern int SherpaOnnxIsKeywordStreamReady(IntPtr spotter, IntPtr stream);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern void SherpaOnnxDecodeKeywordStream(IntPtr spotter, IntPtr stream);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern void SherpaOnnxResetKeywordStream(IntPtr spotter, IntPtr stream);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern IntPtr SherpaOnnxGetKeywordResult(IntPtr spotter, IntPtr stream);
  [DllImport(LIB, CallingConvention=CallingConvention.Cdecl)] static extern void SherpaOnnxDestroyKeywordResult(IntPtr result);

  // ---- microphone (winmm waveIn, 16 kHz mono 16-bit) ----
  [StructLayout(LayoutKind.Sequential)] struct WaveFormat { public ushort tag, channels; public uint rate, bytesPerSec; public ushort blockAlign, bits, cbSize; }
  [StructLayout(LayoutKind.Sequential)] struct WaveHdr { public IntPtr data; public uint length, recorded; public IntPtr user; public uint flags, loops; public IntPtr next, reserved; }
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, uint device, ref WaveFormat fmt, IntPtr callback, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInReset(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInClose(IntPtr h);

  class Mic : IDisposable {
    IntPtr h; readonly List<IntPtr> hdrs = new List<IntPtr>(); readonly AutoResetEvent ready = new AutoResetEvent(false);
    readonly Queue<short> pending = new Queue<short>(); readonly int hdrSize = Marshal.SizeOf(typeof(WaveHdr)), flagsAt = (int)Marshal.OffsetOf(typeof(WaveHdr), "flags"), recAt = (int)Marshal.OffsetOf(typeof(WaveHdr), "recorded");
    public Mic(int rate, int chunk) {
      var f = new WaveFormat { tag = 1, channels = 1, rate = (uint)rate, bits = 16, blockAlign = 2, bytesPerSec = (uint)rate * 2 };
      int r = waveInOpen(out h, 0xFFFFFFFF, ref f, ready.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, 0x50000 /* CALLBACK_EVENT */);
      if (r != 0) throw new Exception("Microphone could not be opened (waveIn " + r + ").");
      for (int i = 0; i < 8; i++) {
        var hdr = new WaveHdr { data = Marshal.AllocHGlobal(chunk * 2), length = (uint)(chunk * 2) };
        IntPtr p = Marshal.AllocHGlobal(hdrSize); Marshal.StructureToPtr(hdr, p, false);
        waveInPrepareHeader(h, p, hdrSize); waveInAddBuffer(h, p, hdrSize); hdrs.Add(p);
      }
      if (waveInStart(h) != 0) throw new Exception("Microphone could not start.");
    }
    /** Blocks until n samples are available. */
    public short[] Read(int n) {
      while (pending.Count < n) {
        ready.WaitOne(200);
        foreach (var p in hdrs) {
          if ((Marshal.ReadInt32(p, flagsAt) & 1) == 0) continue; // WHDR_DONE
          var hdr = (WaveHdr)Marshal.PtrToStructure(p, typeof(WaveHdr)); int got = Marshal.ReadInt32(p, recAt) / 2;
          var buf = new short[got]; Marshal.Copy(hdr.data, buf, 0, got); foreach (var s in buf) pending.Enqueue(s);
          waveInUnprepareHeader(h, p, hdrSize); hdr.recorded = 0; hdr.flags = 0; Marshal.StructureToPtr(hdr, p, false);
          waveInPrepareHeader(h, p, hdrSize); waveInAddBuffer(h, p, hdrSize);
        }
      }
      var outp = new short[n]; for (int i = 0; i < n; i++) outp[i] = pending.Dequeue(); return outp;
    }
    public void Dispose() { waveInReset(h); foreach (var p in hdrs) { waveInUnprepareHeader(h, p, hdrSize); var hdr = (WaveHdr)Marshal.PtrToStructure(p, typeof(WaveHdr)); Marshal.FreeHGlobal(hdr.data); Marshal.FreeHGlobal(p); } waveInClose(h); }
  }

  static float[] ToFloat(short[] s) { var f = new float[s.Length]; for (int i = 0; i < s.Length; i++) f[i] = s[i] / 32768f; return f; }
  static double Rms(short[] f) { double s = 0; foreach (var x in f) s += (double)x * x; return Math.Sqrt(s / f.Length); }

  /** Feeds samples and returns the keyword heard, or null. */
  static string Spot(IntPtr kws, IntPtr stream, short[] pcm, int rate) {
    SherpaOnnxOnlineStreamAcceptWaveform(stream, rate, ToFloat(pcm), pcm.Length);
    string hit = null;
    while (SherpaOnnxIsKeywordStreamReady(kws, stream) == 1) {
      SherpaOnnxDecodeKeywordStream(kws, stream);
      IntPtr r = SherpaOnnxGetKeywordResult(kws, stream);
      if (r != IntPtr.Zero) {
        string k = Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(r, 0)); SherpaOnnxDestroyKeywordResult(r);
        if (!string.IsNullOrEmpty(k)) { hit = k; SherpaOnnxResetKeywordStream(kws, stream); }
      }
    }
    return hit;
  }

  // One line per event to HQ_KWS_LOG (data/wake/kws.log): start, mic level every 30 s, detections, hand-over. No audio or words.
  static void Log(string line) { var f = Environment.GetEnvironmentVariable("HQ_KWS_LOG"); if (string.IsNullOrEmpty(f)) return; try { File.AppendAllText(f, DateTime.Now.ToString("HH:mm:ss.f") + " " + line + Environment.NewLine); } catch {} }
  static float Env(string name, float d) { float v; return float.TryParse(Environment.GetEnvironmentVariable(name) ?? "", System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : d; }

  static int Main(string[] args) {
    bool selftest = args.Length > 1 && args[0] == "--selftest", check = selftest || (args.Length > 0 && args[0] == "--check");
    int port = args.Length > 0 && !check ? int.Parse(args[0]) : 8800;
    string dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "sherpa"), model = Environment.GetEnvironmentVariable("HQ_KWS_MODEL") ?? Path.Combine(dir, "model");
    string enc = Environment.GetEnvironmentVariable("HQ_KWS_ENCODER") ?? "encoder.onnx";
    string keywords = Environment.GetEnvironmentVariable("HQ_KWS_KEYWORDS") ?? "";
    if (!File.Exists(keywords)) { Console.Error.WriteLine("No wake phrase file. Save a wake phrase in Settings → Voice → Wake word."); return 2; }
    SetDllDirectoryW(dir);
    if (LoadLibraryW(Path.Combine(dir, "onnxruntime.dll")) == IntPtr.Zero || LoadLibraryW(Path.Combine(dir, LIB)) == IntPtr.Zero) { Console.Error.WriteLine("Wake word engine files missing in scripts\\sherpa."); return 2; }
    const int rate = 16000;
    var cfg = new KwsConfig {
      feat_config = new FeatureConfig { sample_rate = rate, feature_dim = 80 },
      model_config = new OnlineModelConfig {
        transducer = new TransducerConfig { encoder = Path.Combine(model, enc), decoder = Path.Combine(model, "decoder.onnx"), joiner = Path.Combine(model, "joiner.onnx") },
        tokens = Path.Combine(model, "tokens.txt"), num_threads = 1, provider = "cpu", debug = Environment.GetEnvironmentVariable("HQ_KWS_DEBUG") == "1" ? 1 : 0,
      },
      max_active_paths = 4, num_trailing_blanks = 1, keywords_score = Env("HQ_KWS_SCORE", 1.5f), keywords_threshold = Env("HQ_KWS_THRESHOLD", .25f), keywords_file = keywords,
    };
    IntPtr kws = SherpaOnnxCreateKeywordSpotter(ref cfg);
    if (kws == IntPtr.Zero) { Console.Error.WriteLine("The wake word engine could not start (model or wake phrase file is invalid)."); return 2; }
    IntPtr stream = SherpaOnnxCreateKeywordStream(kws);
    try {
      if (check) {
        if (args.Length > 1) { // --check <16 kHz mono wav>, or --selftest "<phrase>": Windows speaks the phrase into the spotter
          short[] pcm;
          if (selftest) {
            var ms = new MemoryStream();
            using (var tts = new System.Speech.Synthesis.SpeechSynthesizer()) { tts.SetOutputToAudioStream(ms, new SpeechAudioFormatInfo(rate, AudioBitsPerSample.Sixteen, AudioChannel.Mono)); tts.Speak("Okay. " + args[1] + ". What time is it?"); }
            var raw = ms.ToArray(); pcm = new short[raw.Length / 2]; Buffer.BlockCopy(raw, 0, pcm, 0, raw.Length - (raw.Length & 1));
          } else {
            var b = File.ReadAllBytes(args[1]); int at = 12, dataAt = -1, len = 0;
            while (at + 8 <= b.Length) { string id = System.Text.Encoding.ASCII.GetString(b, at, 4); int sz = BitConverter.ToInt32(b, at + 4); if (id == "data") { dataAt = at + 8; len = Math.Min(sz, b.Length - dataAt); break; } at += 8 + sz + (sz & 1); }
            if (dataAt < 0) { Console.Error.WriteLine("Not a wav file."); return 1; }
            pcm = new short[len / 2]; Buffer.BlockCopy(b, dataAt, pcm, 0, len - (len & 1));
          }
          var hits = new List<string>();
          for (int i = 0; i < pcm.Length; i += 1600) { var c = new short[Math.Min(1600, pcm.Length - i)]; Array.Copy(pcm, i, c, 0, c.Length); var k = Spot(kws, stream, c, rate); if (k != null) hits.Add(k + " @" + (i / (double)rate).ToString("0.0") + "s"); }
          var tail = new short[rate]; var t = Spot(kws, stream, tail, rate); if (t != null) hits.Add(t + " @end");
          Console.WriteLine(hits.Count > 0 ? "Heard: " + string.Join(", ", hits) : "Heard: nothing");
        } else Console.WriteLine("Wake word engine ready. Microphone was not opened.");
        return 0;
      }
      using (var mic = new Mic(rate, 1600)) {
        double floor = 200, peak = 0; int n = 0;
        Log("start threshold=" + cfg.keywords_threshold + " score=" + cfg.keywords_score);
        for (;;) {
          var f = mic.Read(1600); // 100 ms
          double e = Rms(f); floor = e < floor ? floor * .9 + e * .1 : floor * .995 + e * .005; // slow-rising noise floor
          peak = Math.Max(peak, e); if (++n % 300 == 0) { Log("mic floor=" + (int)floor + " peak=" + (int)peak); peak = 0; }
          string hit = Spot(kws, stream, f, rate); if (hit == null) continue;
          Log("heard " + hit);
          // Hand over at once (owner, 2026-10-09: recording the rest of the sentence added ~1.5 s and Windows dictation
          // caught nothing). In the LUTHUR window the browser listener has the whole sentence; elsewhere the side panel listens next.
          string text = "";
          for (int tries = 0; ; tries++) {
            try {
              using (var http = new WebClient()) {
                http.Headers["Cookie"] = Environment.GetEnvironmentVariable("HQ_PC_VOICE_COOKIE") ?? ""; http.Headers["X-HQ"] = "1"; http.Headers["Content-Type"] = "application/json";
                http.UploadString("http://127.0.0.1:" + port + "/api/pc-voice/event", new JavaScriptSerializer().Serialize(new { kind = "wake", text = text, front = MainInFront() }));
              }
              Log("handed over");
              return 0; // the dashboard takes over the conversation in the chosen voice
            } catch { if (tries >= 3) { Console.Error.WriteLine("Could not hand the wake word to LUTHUR. Unlock and open the app."); return 1; } Thread.Sleep(1500); }
          }
        }
      }
    } catch (Exception ex) { Log("error " + ex.Message); Console.Error.WriteLine(ex.Message); return 1; }
    finally { SherpaOnnxDestroyOnlineStream(stream); SherpaOnnxDestroyKeywordSpotter(kws); }
  }
}
