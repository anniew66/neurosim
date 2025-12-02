from flask import Flask, request, jsonify
import requests
import json

# Create the Flask application
app = Flask(__name__)

def create_sim(data):
    

# Example route
@app.route('/', methods=['GET', "POST"])
def index():
    return jsonify({"message": "Hello, world!"})

# Example POST route
@app.route('/result', methods=["POST"])
def process():
    data = request.json
    print("hi", data, json.loads(data))
    #sim = create_sim(data)
    return data

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=4900, debug=True)
