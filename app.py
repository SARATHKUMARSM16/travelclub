@app.route('/submit', methods=['POST'])
def submit():
    # Handle form submission
    data = request.get_json()
    name = data.get('name')
    email = data.get('email')

    # Insert data into MongoDB
    user_data = {"name": name, "email": email}
    collection.insert_one(user_data)

    return jsonify({"message": "Data saved successfully!"}), 200