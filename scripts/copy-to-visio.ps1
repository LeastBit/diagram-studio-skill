# Windows PowerShell 5.1+, STA. Import the SVG into a private Visio document,
# then publish Visio's native vector clipboard formats for Ctrl+V.
param([string]$Path)
$ErrorActionPreference = 'Stop'
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw '请在 Windows PowerShell 的 STA 模式下运行。'
}
if (-not $Path) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Filter = 'SVG 矢量图 (*.svg)|*.svg'
    try {
        if ($picker.ShowDialog() -ne 'OK') { return }
        $Path = $picker.FileName
    } finally { $picker.Dispose() }
}
$file = Get-Item -LiteralPath $Path
if ($file.Extension -ne '.svg') { throw '请选择导出的 SVG 文件。' }
Add-Type -AssemblyName System.Windows.Forms
if (-not ("DiagramVisioClipboard" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DiagramVisioClipboard {
    [DllImport("user32.dll",SetLastError=true)] static extern bool OpenClipboard(IntPtr window);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll",SetLastError=true)] static extern bool EmptyClipboard();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetClipboardData(uint format,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
    [DllImport("ole32.dll")] static extern IntPtr OleDuplicateData(IntPtr data,uint format,uint flags);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr data);
    [DllImport("gdi32.dll")] static extern bool DeleteEnhMetaFile(IntPtr data);
    public static void Persist(IntPtr window) {
        bool open=false;
        for(int i=0; i<20 && !(open=OpenClipboard(window)); i++)System.Threading.Thread.Sleep(50);
        if(!open)throw new Win32Exception(Marshal.GetLastWin32Error());
        var copies=new Dictionary<uint,IntPtr>();
        try {
            foreach(uint fmt in new uint[]{14,RegisterClipboardFormat("Visio 15.0 Shapes"),RegisterClipboardFormat("Visio 11.0 Shapes")}) {
                IntPtr data=GetClipboardData(fmt);
                if(data!=IntPtr.Zero) {
                    IntPtr copy=OleDuplicateData(data,fmt,2);
                    if(copy!=IntPtr.Zero)copies.Add(fmt,copy);
                }
            }
            if(copies.Count==0)throw new InvalidOperationException("Visio did not supply vector clipboard data.");
            if(!EmptyClipboard())throw new Win32Exception(Marshal.GetLastWin32Error());
            foreach(uint fmt in new List<uint>(copies.Keys)){
                if(SetClipboardData(fmt,copies[fmt])==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
                copies.Remove(fmt);
            }
        } finally {
            CloseClipboard();
            foreach(var item in copies)if(item.Key==14)DeleteEnhMetaFile(item.Value);else GlobalFree(item.Value);
        }
    }
}
"@
}
$owner = New-Object System.Windows.Forms.Control
function Set-AutoTextWidth($item) {
    if ($item.Text.Length -gt 0) {
        # Retain the original left edge while the text rectangle grows to the right.
        $left = $item.CellsU('TxtPinX').ResultIU - $item.CellsU('TxtLocPinX').ResultIU
        $item.CellsU('TxtPinX').FormulaForceU = $left.ToString('R', [Globalization.CultureInfo]::InvariantCulture) + ' in'
        $item.CellsU('TxtLocPinX').FormulaForceU = '0 in'
        $item.CellsU('TxtWidth').FormulaForceU = 'GUARD(MAX(Width,TEXTWIDTH(TheText)+2 pt))'
    }
    for ($i=1; $i -le $item.Shapes.Count; $i++) { Set-AutoTextWidth $item.Shapes.Item($i) }
}
$visio = New-Object -ComObject Visio.InvisibleApp
try {
    $visio.AlertResponse = 7
    $doc = $visio.Documents.Add('')
    $shape = $doc.Pages.Item(1).Import($file.FullName)
    Set-AutoTextWidth $shape
    $shape.Copy()
    [DiagramVisioClipboard]::Persist($owner.Handle)
    Write-Output '已复制矢量图，可切换到目标 Visio 页面按 Ctrl+V。'
} finally {
    if ($doc) { $doc.Saved = $true; $doc.Close() }
    $visio.Quit()
    $owner.Dispose()
}
