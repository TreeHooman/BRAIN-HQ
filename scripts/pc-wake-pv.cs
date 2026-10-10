// Picovoice Porcupine wake word for LUTHUR (owner ask, 2026-10-09: the browser/Windows recognizers woke at random and
// missed the name). Listens on the default microphone for the owner's keyword ("Hey LUTHUR", trained in Picovoice
// Console) entirely on this PC. On a detection it records the rest of the sentence until a pause, turns that into text
// with Windows dictation (same as pc-wake.exe did), hands it to the dashboard and exits; HQ starts it again later.
// Inputs (never printed): HQ_PV_KEY = AccessKey, HQ_PV_KEYWORD = .ppn path, HQ_PV_SENS = 0..1, HQ_PC_VOICE_COOKIE.
// Library: scripts\pv\libpv_porcupine.dll + porcupine_params.pv (Porcupine v4.0, Apache-2.0).
// Exit codes: 0 handed over / check ok, 1 microphone or HQ problem, 2 Porcupine could not start (key, keyword, files).
using System;
using System.IO;
using System.Net;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Speech.AudioFormat;
using System.Web.Script.Serialization;
using System.Text.RegularExpressions;

class PcWakePv {
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr LoadLibraryW(string path);
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)]
  static extern int pv_porcupine_init([MarshalAs(UnmanagedType.LPStr)] string accessKey, [MarshalAs(UnmanagedType.LPStr)] string modelPath, [MarshalAs(UnmanagedType.LPStr)] string device,
    int numKeywords, [MarshalAs(UnmanagedType.LPArray, ArraySubType=UnmanagedType.LPStr)] string[] keywordPaths, float[] sensitivities, out IntPtr obj);
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pv_porcupine_process(IntPtr obj, short[] pcm, out int keywordIndex);
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern void pv_porcupine_delete(IntPtr obj);
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pv_porcupine_frame_length();
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pv_sample_rate();
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr pv_porcupine_version();
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr pv_status_to_string(int status);
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pv_get_error_stack(out IntPtr stack, out int depth);
  [DllImport("libpv_porcupine.dll", CallingConvention=CallingConvention.Cdecl)] static extern void pv_free_error_stack(IntPtr stack);

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
    readonly Queue<short> pending = new Queue<short>(); readonly int hdrSize = Marshal.SizeOf(typeof(WaveHdr)); readonly int flagsAt = (int)Marshal.OffsetOf(typeof(WaveHdr), "flags"), recAt = (int)Marshal.OffsetOf(typeof(WaveHdr), "recorded");
    public Mic(int rate, int frame) {
      var f = new WaveFormat { tag = 1, channels = 1, rate = (uint)rate, bits = 16, blockAlign = 2, bytesPerSec = (uint)rate * 2 };
      int r = waveInOpen(out h, 0xFFFFFFFF, ref f, ready.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, 0x50000 /* CALLBACK_EVENT */);
      if (r != 0) throw new Exception("Microphone could not be opened (waveIn " + r + ").");
      for (int i = 0; i < 8; i++) {
        var hdr = new WaveHdr { data = Marshal.AllocHGlobal(frame * 2), length = (uint)(frame * 2) };
        IntPtr p = Marshal.AllocHGlobal(hdrSize); Marshal.StructureToPtr(hdr, p, false);
        waveInPrepareHeader(h, p, hdrSize); waveInAddBuffer(h, p, hdrSize); hdrs.Add(p);
      }
      if (waveInStart(h) != 0) throw new Exception("Microphone could not start.");
    }
    /** Blocks until one frame of samples is available. */
    public short[] Read(int frame) {
      while (pending.Count < frame) {
        ready.WaitOne(200);
        foreach (var p in hdrs) {
          if ((Marshal.ReadInt32(p, flagsAt) & 1) == 0) continue; // WHDR_DONE
          var hdr = (WaveHdr)Marshal.PtrToStructure(p, typeof(WaveHdr)); int n = Marshal.ReadInt32(p, recAt) / 2;
          var buf = new short[n]; Marshal.Copy(hdr.data, buf, 0, n); foreach (var s in buf) pending.Enqueue(s);
          waveInUnprepareHeader(h, p, hdrSize); hdr.recorded = 0; hdr.flags = 0; Marshal.StructureToPtr(hdr, p, false);
          waveInPrepareHeader(h, p, hdrSize); waveInAddBuffer(h, p, hdrSize);
        }
      }
      var outp = new short[frame]; for (int i = 0; i < frame; i++) outp[i] = pending.Dequeue(); return outp;
    }
    public void Dispose() { waveInReset(h); foreach (var p in hdrs) { waveInUnprepareHeader(h, p, hdrSize); var hdr = (WaveHdr)Marshal.PtrToStructure(p, typeof(WaveHdr)); Marshal.FreeHGlobal(hdr.data); Marshal.FreeHGlobal(p); } waveInClose(h); }
  }

  static string PvError(int status) {
    string msg = Marshal.PtrToStringAnsi(pv_status_to_string(status)) ?? ("status " + status);
    IntPtr stack; int depth;
    if (pv_get_error_stack(out stack, out depth) == 0 && stack != IntPtr.Zero) {
      for (int i = 0; i < depth; i++) msg += " | " + Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(stack, i * IntPtr.Size));
      pv_free_error_stack(stack);
    }
    return Regex.Replace(msg, @"[A-Za-z0-9+/=]{40,}", "[hidden]"); // never echo anything key-shaped
  }
  static double Rms(short[] f) { double s = 0; foreach (var x in f) s += (double)x * x; return Math.Sqrt(s / f.Length); }

  /** What the owner says after the name, until a pause: Windows dictation over the recorded audio. */
  static string Transcribe(List<short> pcm, int rate) {
    if (pcm.Count < rate / 4) return "";
    var bytes = new byte[pcm.Count * 2]; Buffer.BlockCopy(pcm.ToArray(), 0, bytes, 0, bytes.Length);
    try {
      using (var engine = new SpeechRecognitionEngine(new System.Globalization.CultureInfo("en-US"))) {
        engine.LoadGrammar(new DictationGrammar());
        engine.SetInputToAudioStream(new MemoryStream(bytes), new SpeechAudioFormatInfo(rate, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
        var parts = new List<string>(); RecognitionResult r;
        while ((r = engine.Recognize()) != null) if (r.Confidence >= .3) parts.Add(r.Text);
        return string.Join(" ", parts).Trim();
      }
    } catch { return ""; }
  }

  static int Main(string[] args) {
    bool check = args.Length > 0 && args[0] == "--check";
    int port = args.Length > 0 && !check ? int.Parse(args[0]) : 8800;
    string dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "pv");
    string key = Environment.GetEnvironmentVariable("HQ_PV_KEY") ?? "", keyword = Environment.GetEnvironmentVariable("HQ_PV_KEYWORD") ?? "";
    float sens; if (!float.TryParse(Environment.GetEnvironmentVariable("HQ_PV_SENS") ?? "", System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out sens)) sens = .6f;
    if (key == "") { Console.Error.WriteLine("No Picovoice AccessKey. Add it in Settings → Voice → Wake word."); return 2; }
    if (!File.Exists(keyword)) { Console.Error.WriteLine("Wake word file (.ppn) not found. Add it in Settings → Voice → Wake word."); return 2; }
    if (LoadLibraryW(Path.Combine(dir, "libpv_porcupine.dll")) == IntPtr.Zero) { Console.Error.WriteLine("Picovoice library missing in scripts\\pv."); return 2; }
    IntPtr pv;
    int st = pv_porcupine_init(key, Path.Combine(dir, "porcupine_params.pv"), "cpu:1", 1, new[] { keyword }, new[] { Math.Max(0f, Math.Min(1f, sens)) }, out pv);
    if (st != 0) { Console.Error.WriteLine("Picovoice could not start: " + PvError(st)); return 2; }
    int frame = pv_porcupine_frame_length(), rate = pv_sample_rate();
    if (check) { Console.WriteLine("Picovoice " + Marshal.PtrToStringAnsi(pv_porcupine_version()) + " ready. Microphone was not opened."); pv_porcupine_delete(pv); return 0; }
    try {
      using (var mic = new Mic(rate, frame)) {
        double floor = 200; int idx;
        for (;;) {
          var f = mic.Read(frame);
          double e = Rms(f); floor = e < floor ? floor * .9 + e * .1 : floor * .995 + e * .005; // slow-rising noise floor
          if ((st = pv_porcupine_process(pv, f, out idx)) != 0) { Console.Error.WriteLine("Picovoice stopped: " + PvError(st)); return 2; }
          if (idx < 0) continue;
          // Name heard: keep the sentence that follows ("Hey LUTHUR, what time is it") until ~0.7 s of quiet, max 10 s.
          var said = new List<short>(); int quiet = 0, frames = 0, perSec = rate / frame; bool talking = false; double gate = Math.Max(floor * 3, 350);
          while (frames++ < perSec * 10) {
            var g = mic.Read(frame); said.AddRange(g);
            if (Rms(g) > gate) { talking = true; quiet = 0; } else quiet++;
            if (talking ? quiet > perSec * 7 / 10 : quiet > perSec * 3 / 2) break;
          }
          string text = talking ? Transcribe(said, rate) : "";
          text = Regex.Replace(text, @"^(?:hey\s+)?(?:luthur|luther|luthor)\b[\s,.!?]*", "", RegexOptions.IgnoreCase).Trim();
          for (int tries = 0; ; tries++) {
            try {
              using (var http = new WebClient()) {
                http.Headers["Cookie"] = Environment.GetEnvironmentVariable("HQ_PC_VOICE_COOKIE") ?? ""; http.Headers["X-HQ"] = "1"; http.Headers["Content-Type"] = "application/json";
                http.UploadString("http://127.0.0.1:" + port + "/api/pc-voice/event", new JavaScriptSerializer().Serialize(new { kind = "wake", text = text, engine = "picovoice" }));
              }
              return 0; // the dashboard takes over the conversation in the chosen voice
            } catch { if (tries >= 3) { Console.Error.WriteLine("Could not hand the wake word to LUTHUR. Unlock and open the app."); return 1; } Thread.Sleep(1500); }
          }
        }
      }
    } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    finally { pv_porcupine_delete(pv); }
  }
}
