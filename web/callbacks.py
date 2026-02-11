import pandas as pd
import numpy as np
from dash import Dash, dcc, html, Input, Output, State, ctx, MATCH, ALL, callback_context
import plotly.graph_objs as go
from dash.exceptions import PreventUpdate
import uuid
import requests
import json
from collections import Counter

points_df = pd.DataFrame(columns=["id", "x", "y", "z", "vectors"])


def make_projection(df, plane, mesh_density=60, mesh_range=6):
    """Return a 2D projection figure with invisible click mesh and 3D vector projections."""
    if plane == "xy":
        x, y = "x", "y"
        xlab, ylab = "X", "Y"
    elif plane == "yz":
        x, y = "y", "z"
        xlab, ylab = "Y", "Z"
    else:
        x, y = "x", "z"
        xlab, ylab = "X", "Z"

    grid = np.linspace(-mesh_range, mesh_range, mesh_density)
    gx, gy = np.meshgrid(grid, grid)

    fig = go.Figure()

    # invisible mesh (clickable points)
    fig.add_trace(
        go.Scatter(
            x=gx.flatten(),
            y=gy.flatten(),
            mode="markers",
            marker=dict(size=10, opacity=0),
            hoverinfo="none",
            name="mesh",
        )
    )

    if not df.empty:
        # base points
        fig.add_trace(
            go.Scatter(
                x=df[x],
                y=df[y],
                mode="markers",
                marker=dict(size=10, color="#1976D2"),
                name="points",
            )
        )

        # projected vectors
        for _, r in df.iterrows():
            if not isinstance(r["vectors"], list):
                continue
            for vec in r["vectors"]:
                theta = np.deg2rad(vec["theta"]) if vec["theta"] is not None else 0
                phi = np.deg2rad(vec["phi"]) if vec["phi"] is not None else 0
                dx = np.cos(theta) * np.cos(phi)
                dy = np.sin(theta) * np.cos(phi)
                dz = np.sin(phi)

                if plane == "xy":
                    start_x, start_y = r["x"], r["y"]
                    end_x, end_y = r["x"] + dx, r["y"] + dy
                elif plane == "yz":
                    start_x, start_y = r["y"], r["z"]
                    end_x, end_y = r["y"] + dy, r["z"] + dz
                else:  # xz
                    start_x, start_y = r["x"], r["z"]
                    end_x, end_y = r["x"] + dx, r["z"] + dz

                fig.add_trace(
                    go.Scatter(
                        x=[start_x, end_x],
                        y=[start_y, end_y],
                        mode="lines",
                        line=dict(color="#1e88e5", width=2),
                        showlegend=False,
                    )
                )

    fig.update_layout(
        xaxis_range=[-5,5],
        yaxis_range=[-5,5],
        xaxis_title=xlab,
        yaxis_title=ylab,
        template="plotly_white",
        margin=dict(l=50, r=20, t=40, b=50),
        showlegend=False,
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )
    return fig



def make_point_inputs(df):
    """Return editable coordinate rows for each point."""
    if df.empty:
        return html.P("No points yet.")
    rows = []
    for _, r in df.iterrows():
        rows.append(
            html.Div(
                className="point-row",
                children=[
                    html.Div([html.Div(f"ID {r['id'][:4]}", className="point-id", style={"margin-left": "6px", "margin-right": "0px"}),
                    dcc.Input(
                        id={"type": "coord-input", "axis": "x", "point_id": r["id"]},
                        type="number",
                        value=round(r["x"], 2),
                        className="coord-input",
                    ),
                    dcc.Input(
                        id={"type": "coord-input", "axis": "y", "point_id": r["id"]},
                        type="number",
                        value=round(r["y"], 2),
                        className="coord-input",
                    ),
                    dcc.Input(
                        id={"type": "coord-input", "axis": "z", "point_id": r["id"]},
                        type="number",
                        value=round(r["z"], 2),
                        className="coord-input",
                    )], style={"display": "flex", "gap": "2"}),
                    html.Div([dcc.Dropdown(id={"type": "element-dd", "axis": "gc", "index": r["id"]}, className="element-input", options=["Granule"], value="Granule"), 
                              dcc.Input(id={"type": "time-input", "axis": "gc", "index": r["id"]}, className="coord-input", style={"width": "17.5vw"}, placeholder="Start Time"),
                              dcc.Input(id={"type": "axon-input", "axis": "gc", "index": r["id"]}, className="coord-input", style={"width": "17.5vw"}, placeholder="Axon Promiscuity"),
                              dcc.Input(id={"type": "size-input", "axis": "gc", "index": r["id"]}, className="coord-input", style={"width": "17.5vw"}, placeholder="Soma Size"),
                              dcc.Input(id={"type": "compound-secretion", "axis": "gc", "index": r["id"]}, className="coord-input", style={"width": "17.5vw"}, placeholder="Chemicals to be Secreted"),
                              dcc.Input(id={"type": "secretion-rate", "axis": "gc", "index": r["id"]}, className="coord-input", style={"width": "17.5vw"}, placeholder="Secretion Rate"),
                              dcc.Input(id={"type": "compound-decay", "axis": "gc", "index": r["id"]}, className="coord-input", style={"width": "17.5vw"}, placeholder="Compound Decay"),
                              dcc.Input(id={"type": "synapse-radius", "axis": "gc", "index": r["id"]}, className="coord-input", style={"width": "17.5vw"}, placeholder="Synapse Radius")
                    , html.Div([html.Button(
                        "Add Neurite",
                        id={"type": "add-vector", "point_id": r["id"]},
                        n_clicks=0,
                        className="small-button",
                    ), html.Button(
                        "Remove Neurite", 
                        id={"type": "remove-vector", "point_id": r["id"]}, 
                        n_clicks=0,
                        className="small-button",
                    ), html.Button(
                        "Remove Neuron",
                        id={"type": "remove-btn", "point_id": r["id"]},
                        n_clicks=0,
                        className="small-button",
                    )], style={"display": "flex", "justify-content": "space-between", "margin-right": "6px"})])
                ],
            )
        )
        if isinstance(r["vectors"], list):
            print("here vector")
            print(r["vectors"])
            for i, v in enumerate(r["vectors"]):
                rows.append(
                    html.Div(
                        className="vector-row",
                        children=[
                            html.Div(f"Neurite {i+1}", className="vector-label"),
                            dcc.Input(
                                id={
                                    "type": "vector-input",
                                    "coord": "theta",
                                    "point_id": r["id"],
                                    "vec_index": i,
                                },
                                type="number",
                                value=round(v["theta"], 1) if v["theta"] is not None else 0,
                                className="coord-input",
                            ),
                            dcc.Input(
                                id={
                                    "type": "vector-input",
                                    "coord": "phi",
                                    "point_id": r["id"],
                                    "vec_index": i,
                                },
                                type="number",
                                value=round(v["phi"], 1) if v["phi"] is not None else 0,
                                className="coord-input",
                            ),
                        ],
                    )
                )
    return rows


def getCallbacks(app):
    
    @app.callback(
    Output("graph-xy", "style"),
    Output("graph-yz", "style"),
    Output("graph-xz", "style"),
    Input("plane-tabs", "value"),
    )
    def show_only_active_graph(tab):
        hide = {"display": "none"}
        show = {"display": "block"}
        return (
        show if tab == "xy" else hide,
        show if tab == "yz" else hide,
        show if tab == "xz" else hide,
        )


    @app.callback(
        Output("graph-xy", "figure"),
        Output("graph-yz", "figure"),
        Output("graph-xz", "figure"),
        Output("point-controls", "children"),
        Input("graph-xy", "clickData"),
        Input("graph-yz", "clickData"),
        Input("graph-xz", "clickData"),
        Input({"type": "remove-btn", "point_id": ALL}, "n_clicks"),
        Input({"type": "coord-input", "axis": ALL, "point_id": ALL}, "value"),
        State({"type": "coord-input", "axis": ALL, "point_id": ALL}, "id"),
        Input({"type": "vector-input", "coord": ALL, "point_id": ALL, "vec_index": ALL}, "value"),
        State({"type": "vector-input", "coord": ALL, "point_id": ALL, "vec_index": ALL}, "id"),
        Input({"type": "add-vector", "point_id": ALL}, "n_clicks"),
        Input({"type": "remove-vector", "point_id": ALL}, "n_clicks"),
    )
    def update_points(xy_click, yz_click, xz_click, remove_clicks, values, ids, vector_values, vector_ids, vector_add_clicks, vector_remove_clicks):
        global points_df
        trigger = ctx.triggered_id
        rep_index = 0
        for i, row in enumerate(vector_ids):
            if row == ctx.triggered_id:
                print("rephere", i, ctx.triggered_id)
                rep_index = i
        print("here3")
        # coordinate edits
        if isinstance(trigger, dict) and trigger.get("type") == "coord-input":
            for i, coord_id in enumerate(ids):
                pid = coord_id["point_id"]
                axis = coord_id["axis"]
                value = values[i]
                if pid in points_df["id"].values and value is not None:
                    points_df.loc[points_df["id"] == pid, axis] = value
        elif isinstance(trigger, dict) and trigger.get("type") == "remove-btn":
            print("here2")
            print(points_df)
            if not points_df.empty:
                points_df = points_df[points_df["id"] != trigger.get("point_id")]

        # add new point
        elif trigger == "graph-xy" and xy_click:
            x = xy_click["points"][0]["x"]
            y = xy_click["points"][0]["y"]
            z = 0.0
            points_df.loc[len(points_df)] = [str(uuid.uuid4()), x, y, z, [{"theta": 0.0, "phi": 0.0}]]
        elif trigger == "graph-yz" and yz_click:
            y = yz_click["points"][0]["x"]
            z = yz_click["points"][0]["y"]
            x = 0.0
            points_df.loc[len(points_df)] = [str(uuid.uuid4()), x, y, z, [{"theta": 0.0, "phi": 0.0}]]
        elif trigger == "graph-xz" and xz_click:
            x = xz_click["points"][0]["x"]
            z = xz_click["points"][0]["y"]
            y = 0.0
            points_df.loc[len(points_df)] = [str(uuid.uuid4()), x, y, z, [{"theta": 0.0, "phi": 0.0}]]
        elif isinstance(trigger, dict) and trigger.get("type") == "add-vector":
            print("here2")
            pid = trigger["point_id"]
            if pid in points_df["id"].values:
                vecs = points_df.loc[points_df["id"] == pid, "vectors"].values[0]
                print("v", vecs)
                if not isinstance(vecs, list):
                    vecs = []
                vecs.append({"theta": 0.0, "phi": 0.0})
        elif isinstance(trigger, dict) and trigger.get("type") == "remove-vector":
            print("here3")
            pid = trigger["point_id"]
            if pid in points_df["id"].values:
                vecs = points_df.loc[points_df["id"] == pid, "vectors"].values[0]
                print("v2", vecs)
                if not isinstance(vecs, list):
                    vecs = []
                if vecs: 
                    vecs.pop()

        elif isinstance(trigger, dict) and trigger.get("type") == "vector-input":
            pid = trigger["point_id"]
            coord = trigger["coord"]
            idx = trigger["vec_index"]
            val = vector_values[rep_index]

            if pid in points_df["id"].values:
                vecs = points_df.loc[points_df["id"] == pid, "vectors"].values[0]
                if isinstance(vecs, list) and idx < len(vecs):
                    
                    vecs[idx][coord] = val

        else:
            raise PreventUpdate

        # rebuild figures and sidebar inputs
        fig_xy = make_projection(points_df, "xy")
        fig_yz = make_projection(points_df, "yz")
        fig_xz = make_projection(points_df, "xz")
        controls = make_point_inputs(points_df)

        return fig_xy, fig_yz, fig_xz, controls


    @app.callback(Output("results_container", "data"),
        Input("run-sim", "n_clicks"),
        State({"type": "coord-input", "axis": ALL, "point_id": ALL}, "value"),
        State({"type": "coord-input", "axis": ALL, "point_id": ALL}, "id"),
        State({"type": "vector-input", "coord": ALL, "point_id": ALL, "vec_index": ALL}, "value"),
        State({"type": "vector-input", "coord": ALL, "point_id": ALL, "vec_index": ALL}, "id"),
        State({"type": "time-input", "index": ALL, "vec_index": ALL}, "value"),
        State({"type": "element-dd", "index": ALL, "vec_index": ALL}, "value"),
        State({"type": "axon-input", "index": ALL, "vec_index": ALL}, "value"),
        State({"type": "compound-secretion", "index": ALL, "vec_index": ALL}, "value"),
        State({"type": "secretion-rate", "index": ALL, "vec_index": ALL}, "value"),
        State({"type": "compound-decay", "index": ALL, "vec_index": ALL}, "value"),
        State({"type": "synapse-radius", "index": ALL, "vec_index": ALL}, "value"),
        prevent_initial_call=True, allow_optional = True
        )
    def send_request(clicks, points, point_ids, neurites, neurite_ids, time, element, axon,compound, secretion_rate, decay, synapse_radius ):
        print(callback_context.states)
        print(secretion_rate, "this is for secretion rate")
        print(decay)
        print(element)
        print(time)
        
        id_list = []
        ## Generate dictionary of neuron coords with correct IDs
        [id_list.append(i["point_id"]) for i in point_ids if i["point_id"] not in id_list]
        coord_list = [points[i:i+3] for i in range(0, len(points), 3)] 
        coords = dict(zip(id_list, coord_list))
        ## Generate dictionary of neurite angles with correct IDs
        angle_ids = []
        [angle_ids.append(neurite_ids[i]["point_id"]) for i in range(0, len(neurite_ids), 2)]
        angle_ids = dict(Counter(angle_ids))
        angle_list = [neurites[i:i+2] for i in range(0, len(neurites), 2)] 
        pos = 0
        angles = {}
        for k, v in angle_ids.items():
            angles[k] = angle_list[pos:pos+v]
            pos = pos + v
        result = requests.post("http://127.0.0.1:4900/result", json=json.dumps({"neurons": coords, "neurites": angles, "neuronType": element }))
        return {"filename": "download.json", "content": result.text}

