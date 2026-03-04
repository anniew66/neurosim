from paraview.simple import *

pvd = OpenDataFile(r"/Users/awang/Desktop/neurosim/vtk_output/simulation.pvd")
RenameSource("neurosim", pvd)
Show(pvd)

renderView = GetActiveViewOrCreate("RenderView")
renderView.Background = [0.1, 0.1, 0.1]

glyph = Glyph(Input=pvd, GlyphType="Sphere")
glyph.ScaleArray       = ["POINTS", "radius"]
glyph.ScaleFactor      = 1.0
glyph.GlyphMode        = "All Points"
glyph.GlyphType.Radius = 1.0

glyphDisp = Show(glyph, renderView)
glyphDisp.Representation = "Surface"

ColorBy(glyphDisp, ("POINTS", "agent_type"))
agentLUT = GetColorTransferFunction("agent_type")
agentLUT.RGBPoints = [
    0.0, 0.17, 0.51, 0.85,
    1.0, 0.85, 0.15, 0.15,
]
agentLUT.ColorSpace = "RGB"
glyphDisp.LookupTable = agentLUT
glyphDisp.SetScalarBarVisibility(renderView, True)

tube = Tube(Input=pvd)
tube.Radius = 0.4
tubeDisp = Show(tube, renderView)
tubeDisp.Representation = "Surface"
tubeDisp.AmbientColor   = [1.0, 0.85, 0.0]
tubeDisp.DiffuseColor   = [1.0, 0.85, 0.0]

ResetCamera()
animScene = GetAnimationScene()
animScene.UpdateAnimationUsingDataTimeSteps()
Render()
print("neurosim loaded. Press Play to animate.")
