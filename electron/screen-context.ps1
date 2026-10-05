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
$result = @{ source_app=$root.Current.Name; target_name=$target.Current.Name; url=''; time=''; bounds=@{ x=$bounds.X; y=$bounds.Y; width=$bounds.Width; height=$bounds.Height } }
# Use only the chosen application's accessible controls, not other windows.
$controls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i=0; $i -lt [Math]::Min($controls.Count, 500); $i++) {
    $control = $controls.Item($i)
    if ($control.Current.IsPassword) { continue }
    $name = $control.Current.Name
    if ($name -match '^\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*/\s*\d') { $result.time = $Matches[1] }
    $pattern = $null
    if ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $value = $pattern.Current.Value
        if ($value -match '^(https?://)?(www\.)?(youtube\.com/|youtu\.be/|vimeo\.com/)[^\s]+$') {
            $result.url = if ($value.StartsWith('http')) { $value } else { 'https://' + $value }
        }
    }
}
$result | ConvertTo-Json -Depth 4 -Compress
