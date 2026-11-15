param(
  [double]$WidthRatio = 0.7875,
  [double]$HeightRatio = 0.8144,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class WinFit
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT
    {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);
}
'@

# Per-monitor DPI awareness keeps every coordinate in real screen pixels.
[void][WinFit]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))

function Write-FitLog([string]$message) {
    $path = Join-Path $env:TEMP 'dsh-window-fit.log'
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -Path $path -Value "[$stamp] $message" -ErrorAction SilentlyContinue
}

$screenWidth = [WinFit]::GetSystemMetrics(0)
$screenHeight = [WinFit]::GetSystemMetrics(1)
if ($screenWidth -le 0 -or $screenHeight -le 0) { exit 2 }

$targetWidth = [int][Math]::Round($screenWidth * $WidthRatio)
$targetHeight = [int][Math]::Round($screenHeight * $HeightRatio)
$targetX = [int][Math]::Round(($screenWidth - $targetWidth) / 2)
$targetY = [int][Math]::Round(($screenHeight - $targetHeight) / 2)
Write-FitLog "start screen=${screenWidth}x${screenHeight} ratios=$WidthRatio/$HeightRatio target=${targetWidth}x${targetHeight}"

$processIds = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
if ($processIds.Count -eq 0) { exit 3 }

$deadline = (Get-Date).AddSeconds([Math]::Max(5, $TimeoutSeconds))
$target = [IntPtr]::Zero

while ((Get-Date) -lt $deadline -and $target -eq [IntPtr]::Zero) {
    $script:match = [IntPtr]::Zero
    $callback = [WinFit+EnumWindowsProc] {
        param($hWnd, $lParam)
        $procId = [uint32]0
        [void][WinFit]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        if ($processIds -contains $procId) {
            $class = New-Object System.Text.StringBuilder 128
            [void][WinFit]::GetClassName($hWnd, $class, 128)
            if ($class.ToString() -eq 'Chrome_WidgetWin_1') {
                $title = New-Object System.Text.StringBuilder 512
                [void][WinFit]::GetWindowText($hWnd, $title, 512)
                if ($title.ToString() -like '*DeepSeek Harness*') {
                    $placement = New-Object WinFit+WINDOWPLACEMENT
                    $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
                    [void][WinFit]::GetWindowPlacement($hWnd, [ref]$placement)
                    $rect = $placement.rcNormalPosition
                    if (($rect.Right - $rect.Left) -gt 600) { $script:match = $hWnd }
                }
            }
        }
        return $true
    }
    [void][WinFit]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:match -ne [IntPtr]::Zero) { $target = $script:match; break }
    Start-Sleep -Milliseconds 500
}

if ($target -eq [IntPtr]::Zero) {
    Write-FitLog 'window not found before timeout'
    exit 4
}

# A minimized window ignores bounds updates, so restore it briefly and minimize
# it again afterwards; a visible window is resized in place without activation.
$placement = New-Object WinFit+WINDOWPLACEMENT
$placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
$placed = [WinFit]::GetWindowPlacement($target, [ref]$placement)
$wasMinimized = $placed -and $placement.showCmd -eq 2

if ($wasMinimized) { [void][WinFit]::ShowWindow($target, 9) }

# SWP_NOZORDER (0x4) | SWP_NOACTIVATE (0x10)
$flags = 0x0004 -bor 0x0010
[void][WinFit]::SetWindowPos($target, [IntPtr]::Zero, $targetX, $targetY, $targetWidth, $targetHeight, $flags)

if ($wasMinimized) { [void][WinFit]::ShowWindow($target, 6) }

$final = New-Object WinFit+RECT
[void][WinFit]::GetWindowRect($target, [ref]$final)
Write-FitLog "applied window=$($final.Right - $final.Left)x$($final.Bottom - $final.Top) at $($final.Left),$($final.Top) minimized=$wasMinimized"
exit 0
