# Enable CORS for all routes
from flask import Flask
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ...existing code...
