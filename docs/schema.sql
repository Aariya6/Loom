
CREATE TABLE users (
	id INTEGER NOT NULL, 
	email VARCHAR(320) NOT NULL, 
	password_hash VARCHAR(512) NOT NULL, 
	display_name VARCHAR(120) NOT NULL, 
	active BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
)

;


CREATE TABLE audit_events (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	event VARCHAR(100) NOT NULL, 
	detail_json TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;


CREATE TABLE projects (
	id INTEGER NOT NULL, 
	owner_id INTEGER NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	bpm FLOAT NOT NULL, 
	state_json TEXT NOT NULL, 
	revision INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)

;


CREATE TABLE sessions (
	id INTEGER NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	user_id INTEGER NOT NULL, 
	csrf_token VARCHAR(128) NOT NULL, 
	expires_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;


CREATE TABLE notes (
	id INTEGER NOT NULL, 
	owner_id INTEGER NOT NULL, 
	project_id INTEGER NOT NULL, 
	body TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
)

;


CREATE TABLE project_versions (
	id INTEGER NOT NULL, 
	project_id INTEGER NOT NULL, 
	revision INTEGER NOT NULL, 
	state_json TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
)

;
