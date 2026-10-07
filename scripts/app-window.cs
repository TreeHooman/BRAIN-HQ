using System;
using System.Diagnostics;
using System.Threading;
using System.Text;
using System.Runtime.InteropServices;
class AppWindow {
 delegate bool Callback(IntPtr window,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr w,StringBuilder text,int count);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr w,int cmd);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr w);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr w,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr w,int index);
 [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr w,int index,int value);
 [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr w,uint color,byte alpha,uint flags);
 static bool Overlay(bool hide=false){bool found=false;EnumWindows((w,d)=>{var text=new StringBuilder(512);GetWindowText(w,text,512);if(text.ToString().Equals("LUTHUR Hologram",StringComparison.OrdinalIgnoreCase)){
   found=true;if(hide){ShowWindow(w,0);return false;}ShowWindow(w,9);
   var info=new MonitorInfo();info.size=Marshal.SizeOf(info);GetMonitorInfo(MonitorFromWindow(GetForegroundWindow(),2),ref info);
   int width=Math.Min(430,info.work.right-info.work.left-24),height=Math.Min(690,info.work.bottom-info.work.top-24);
   // A translucent tool window stays above the owner's other apps; the full window is untouched.
   SetWindowLong(w,-20,GetWindowLong(w,-20)|0x80000|0x80);SetLayeredWindowAttributes(w,0,238,2);
   SetWindowPos(w,new IntPtr(-1),info.work.right-width-18,info.work.bottom-height-18,width,height,0x0040);SetForegroundWindow(w);return false;
  }return true;},IntPtr.Zero);return found;}
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr w,out Rect rect);
 [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr w,uint flags);
 [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr w,uint message,IntPtr key,IntPtr data);
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {public int size;public Rect monitor,work;public uint flags;}
 static bool SameBounds(Rect a,Rect b){return Math.Abs(a.left-b.left)<=2&&Math.Abs(a.top-b.top)<=2&&Math.Abs(a.right-b.right)<=2&&Math.Abs(a.bottom-b.bottom)<=2;}
 static bool FullScreen(IntPtr w){Rect r;var info=new MonitorInfo();info.size=Marshal.SizeOf(info);return GetWindowRect(w,out r)&&GetMonitorInfo(MonitorFromWindow(w,2),ref info)&&SameBounds(r,info.monitor);}
 static bool Focus(bool fullscreen=true){bool found=false;EnumWindows((w,d)=>{var text=new StringBuilder(512);GetWindowText(w,text,512);if(IsWindowVisible(w)&&text.ToString().Equals("LUTHUR",StringComparison.OrdinalIgnoreCase)){ShowWindow(w,9);SetForegroundWindow(w);if(fullscreen&&!FullScreen(w)&&GetForegroundWindow()==w){PostMessage(w,0x100,new IntPtr(0x7A),new IntPtr(1));PostMessage(w,0x101,new IntPtr(0x7A),new IntPtr(unchecked((int)0xC0000001)));}found=true;return false;}return true;},IntPtr.Zero);return found;}
 static int Main(string[] args){
  bool overlay=args.Length>0&&args[0]=="--overlay",hide=args.Length>0&&args[0]=="--hide-overlay";
  if(hide){Overlay(true);return 0;}
  if(args.Length>0&&args[0]=="--main-from-overlay")Overlay(true);
  int port=8800;if(overlay&&args.Length>1&&!int.TryParse(args[1],out port))return 1;
  using(var mutex=new Mutex(false,overlay?"Local\\LUTHUR.OverlayLaunch":"Local\\LUTHUR.AppLaunch")){
   bool held=false;
   try {try{held=mutex.WaitOne(30000);}catch(AbandonedMutexException){held=true;}
    if(!held)return 0;
    if(args.Length>0&&args[0]=="--check"){var monitor=new Rect{left=0,top=0,right=1920,bottom=1080};if(!SameBounds(monitor,monitor)||SameBounds(new Rect{left=-8,top=-8,right=1928,bottom=1048},monitor))return 1;Console.WriteLine("Single-window mutex and full-screen bounds checks passed.");return 0;}
    if(overlay?Overlay():Focus())return 0;
    string profile=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LUTHUR","window");
    string launchArgs=" --app=http://localhost:"+port+(overlay?"/?overlay=1#command --window-size=430,690":"/ --start-fullscreen")+" --no-first-run --no-default-browser-check --user-data-dir=\""+profile+"\"";
    bool launched=false;
    foreach(string browser in new[]{"chrome","msedge"}){try{Process.Start(new ProcessStartInfo(browser,launchArgs){UseShellExecute=true});launched=true;break;}catch{}}
    if(!launched){if(overlay)return 1;Process.Start("http://localhost:8800/");}
    for(int i=0;i<40;i++){Thread.Sleep(500);if(overlay?Overlay():Focus(false))break;}
    return 0;
   } finally{if(held)mutex.ReleaseMutex();}
  }
 }
}
