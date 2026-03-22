from paraview.simple import *
import sys

# ── Load data ────────────────────────────────────────────────────────────
pvd = OpenDataFile(r"C:\Users\j15he\Documents\neurosim\vtk_output\simulation.pvd")
RenameSource('neurosim', pvd)

renderView = GetActiveViewOrCreate('RenderView')
renderView.Background = [0.05, 0.05, 0.1]

# ── Sphere glyphs: 0=soma(white) 1=axon(blue) 2=dendrite(red) 3=shaft(grey) ──
sphereSrc = Sphere()
sphereSrc.ThetaResolution = 14
sphereSrc.PhiResolution   = 14
glyph = Glyph(Input=pvd, GlyphType=sphereSrc)
glyph.ScaleArray  = ['POINTS', 'radius']
glyph.ScaleFactor = 1.0
glyph.GlyphMode   = 'All Points'
glyphDisp = Show(glyph, renderView)
glyphDisp.Representation = 'Surface'
ColorBy(glyphDisp, ('POINTS', 'agent_type'))
lut = GetColorTransferFunction('agent_type')
lut.RGBPoints = [0.0,1.00,1.00,1.00, 1.0,0.17,0.51,0.85, 2.0,0.85,0.15,0.15, 3.0,0.45,0.45,0.45]
lut.ColorSpace = 'RGB'
glyphDisp.LookupTable = lut
glyphDisp.SetScalarBarVisibility(renderView, True)

# ── Neurite shafts as tubes ──────────────────────────────────────────────
# ExtractSurface converts vtkUnstructuredGrid -> vtkPolyData for Tube.
surf = ExtractSurface(Input=pvd)
tube = Tube(Input=surf)
tube.Radius = 0.25
# ParaView spells this differently across versions — try both
try:
    tube.NumberofSides = 8
except AttributeError:
    try:
        tube.NumberOfSides = 8
    except AttributeError:
        pass  # older ParaView uses the filter default, that is fine
tubeDisp = Show(tube, renderView)
tubeDisp.Representation = 'Surface'
ColorBy(tubeDisp, ('POINTS', 'agent_type'))
tubeDisp.LookupTable = lut
tubeDisp.Opacity = 0.75

# ── Agent ID labels ──────────────────────────────────────────────────────
# Threshold out shaft interpolation points (agent_id == 0) so only
# real agents get labels. Labels are added via the spreadsheet-style
# API which is stable across ParaView 5.x and 6.x.
thresh = Threshold(Input=pvd)
thresh.Scalars   = ['POINTS', 'agent_id']
thresh.LowerThreshold = 1
thresh.UpperThreshold = 999999
threshDisp = Show(thresh, renderView)
threshDisp.Representation = 'Point Gaussian'
threshDisp.GaussianRadius = 0.001  # effectively invisible points
threshDisp.SetScalarBarVisibility(renderView, False)
# Enable point labels through the display properties dict
try:
    threshDisp.PointLabelVisibility = 1
    threshDisp.PointLabelArrayName  = 'agent_id'
    threshDisp.PointLabelFontSize   = 9
    threshDisp.PointLabelColor      = [1.0, 1.0, 0.6]
    threshDisp.PointLabelFormat     = '%-#6.0f'
except AttributeError:
    # Labels not supported via script in this ParaView build.
    # In the GUI: select the threshold source -> Filters -> Label.
    print('Note: point labels not available via script — add manually if needed.')

# ── Camera & animation ───────────────────────────────────────────────────
ResetCamera()
animScene = GetAnimationScene()
animScene.UpdateAnimationUsingDataTimeSteps()
Render()
print(''')
print('neurosim loaded:')
print('  agent_type  0=soma  1=axon tip  2=dendrite tip  3=neurite shaft')
print('  Press Play (toolbar) to animate through timesteps.')
print('  Right-click pipeline entries to toggle visibility.')
print(''')
Interact()
