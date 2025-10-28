import pandas as pd
import numpy as np
from dash import Dash, dcc, html, Input, Output, State, ctx, MATCH, ALL
import plotly.graph_objs as go
from dash.exceptions import PreventUpdate
import uuid
import callbacks as cB
from callbacks import points_df, make_projection


app = Dash(__name__)

cB.getCallbacks(app)

app.title = "NeuroSimulator"

app.layout = html.Div(
    className="main-container",
    children=[
        html.Div(
            className="sidebar",
            children=[
                html.H2("Element Menu", className="sidebar-title"),
                html.Div(id="point-controls", className="point-controls"),
                ],
        ),
        html.Div(
            className="content-area", 
            children=[
                html.Div([html.H1("Simulation Builder", className="title"), html.Button("Run Simulation", id="run-sim", className="submit-button")], style={"display": "flex", "justify-content": "space-between"}),
                dcc.Tabs(
                    id="plane-tabs",
                    value="xy",
                    className="tabs-container",
                    children=[
                        dcc.Tab(label="XY Plane", value="xy", className="tab"),
                        dcc.Tab(label="YZ Plane", value="yz", className="tab"),
                        dcc.Tab(label="XZ Plane", value="xz", className="tab"),
                    ],
                ),
                html.Div(
                    className="graph-container",
                    children=[
                        dcc.Graph(id="graph-xy", figure=make_projection(points_df, "xy"), style={"width": "70vw", "height": "70vw"}),
                        dcc.Graph(id="graph-yz", figure=make_projection(points_df, "yz"), style={"width": "70vw", "height": "70vw"}),
                        dcc.Graph(id="graph-xz", figure=make_projection(points_df, "xz"), style={"width": "70vw", "height": "70vw"}),
                    ],
                ),
            ],
        ),
    ],
)


if __name__ == "__main__":
    app.run(debug=True, port=8008)
