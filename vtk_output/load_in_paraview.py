from paraview.simple import *
pvd = OpenDataFile(r"C:\Users\j15he\Documents\neurosim\vtk_output\simulation.pvd")
rv = GetActiveViewOrCreate('RenderView')
rv.Background = [0.08, 0.08, 0.10]
sphereSrc = Sphere()
sphereSrc.ThetaResolution = 12; sphereSrc.PhiResolution = 10
glyph = Glyph(Input=pvd, GlyphType=sphereSrc)
glyph.ScaleArray = ['POINTS','radius']; glyph.ScaleFactor = 1.0
glyph.GlyphMode = 'All Points'
gd = Show(glyph, rv); gd.Representation = 'Surface'
ColorBy(gd, ('POINTS','agent_type'))
lut = GetColorTransferFunction('agent_type')
lut.RGBPoints = [0,0.9,0.9,0.9, 1,0.3,0.6,0.9, 2,0.8,0.2,0.2, 3,0.45,0.45,0.45, 4,0.3,0.3,0.3]
lut.ColorSpace = 'RGB'; gd.LookupTable = lut
tube = Tube(Input=pvd); tube.Radius = 0.0003
td = Show(tube, rv); td.Opacity = 0.65; td.LookupTable = lut
ResetCamera()
animScene = GetAnimationScene()
animScene.UpdateAnimationUsingDataTimeSteps()
Render(); Interact()
