from paraview.simple import *
from paraview import servermanager

pvd = OpenDataFile(r"C:\Users\j15he\Documents\neurosim\vtk_output\simulation.pvd")
RenameSource('neurosim', pvd)

renderView = GetActiveViewOrCreate('RenderView')
renderView.Background = [0.05, 0.05, 0.1]

# ── Sphere glyphs for agent nodes ────────────────────────────────────────
# agent_type: 0=soma(white)  1=axon tip(blue)  2=dendrite tip(red)  3=shaft pt(hidden)
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
# 0=soma white  1=axon blue  2=dendrite red  3=shaft grey (tiny, mostly hidden)
lut.RGBPoints = [0.0,1.00,1.00,1.00, 1.0,0.17,0.51,0.85, 2.0,0.85,0.15,0.15, 3.0,0.45,0.45,0.45]
lut.ColorSpace = 'RGB'
glyphDisp.LookupTable = lut
glyphDisp.SetScalarBarVisibility(renderView, True)

# ── Neurite shafts as tubes ──────────────────────────────────────────────
# The VTK_POLY_LINE cells trace soma -> shaft points -> growth cone tip.
# ExtractSurface converts UnstructuredGrid -> PolyData for the Tube filter.
surf = ExtractSurface(Input=pvd)
tube = Tube(Input=surf)
tube.Radius = 0.25
tube.NumberOfSides = 8
tubeDisp = Show(tube, renderView)
tubeDisp.Representation = 'Surface'
# Color axon shafts blue, dendrite shafts red via the same agent_type LUT
ColorBy(tubeDisp, ('POINTS', 'agent_type'))
tubeDisp.LookupTable = lut
tubeDisp.Opacity = 0.75

# ── Agent ID labels ──────────────────────────────────────────────────────
# Show the integer agent_id floating next to each agent node.
# Only label actual agents (agent_id > 0), not shaft interpolation points.
thresh = Threshold(Input=pvd)
thresh.Scalars = ['POINTS', 'agent_id']
thresh.LowerThreshold = 1
thresh.UpperThreshold = 99999
labelDisp = Show(thresh, renderView)
labelDisp.Representation = 'Point Gaussian'
labelDisp.GaussianRadius = 0.0   # invisible — labels only
labelDisp.SelectInputVectors = ['POINTS', 'agent_id']
labelDisp.SetScalarBarVisibility(renderView, False)
# Attach text labels
labelDisp.PointLabelVisibility = True
labelDisp.PointLabelArrayName  = 'agent_id'
labelDisp.PointLabelFontSize   = 10
labelDisp.PointLabelColor      = [1.0, 1.0, 0.6]
labelDisp.PointLabelFormat     = '%d'

# ── Camera & animation ───────────────────────────────────────────────────
ResetCamera()
animScene = GetAnimationScene()
animScene.UpdateAnimationUsingDataTimeSteps()
Render()
print('neurosim: 0=soma  1=axon  2=dendrite  3=shaft -- Press Play to animate')
Interact()
