# Modified / added code: Lines 1-49 (Source resolver: process, window title, control types, universal URL, video timing)
param([int]$PointX, [int]$PointY)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$target = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($PointX, $PointY)))
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$root = $target
for ($i=0; $i -lt 20; $i++) {
    $parent = $walker.GetParent($root)
    if ($null -eq $parent -or $parent -eq [System.Windows.Automation.AutomationElement]::RootElement) { break }
    $root = $parent
}
$bounds = $target.Current.BoundingRectangle
$procName = try { [System.Diagnostics.Process]::GetProcessById($root.Current.ProcessId).ProcessName } catch { '' }
$ctrlType = try { $target.Current.ControlType.ProgrammaticName.Replace('ControlType.', '') } catch { '' }
$result = @{
    source_app = $root.Current.Name;
    window_title = $root.Current.Name;
    process_name = $procName;
    control_type = $ctrlType;
    target_name = $target.Current.Name;
    url = '';
    time = '';
    bounds = @{ x=$bounds.X; y=$bounds.Y; width=$bounds.Width; height=$bounds.Height }
}
# Use only the chosen application's accessible controls, not other windows.
$controls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i=0; $i -lt [Math]::Min($controls.Count, 500); $i++) {
    $control = $controls.Item($i)
    if ($control.Current.IsPassword) { continue }
    $name = $control.Current.Name
    if ($name -match '^\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*(?:/|\sof\s)\s*\d') { $result.time = $Matches[1] }
    $val = $null
    $pattern = $null
    if ($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $val = $pattern.Current.Value
    } elseif ($control.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$pattern)) {
        $val = $pattern.Current.Value
    }
    if ($val) {
        if ($val -match '^(https?://[^\s]+|(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:/[^\s]*)?)$') {
            $result.url = if ($val.StartsWith('http')) { $val } else { 'https://' + $val }
        }
    }
}
$result | ConvertTo-Json -Depth 4 -Compress
