-- Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
-- SPDX-License-Identifier: Apache-2.0

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    pet_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'completed',
    adoption_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Insert sample users
INSERT INTO users (user_id, full_name, email) VALUES 
('user1', 'John Doe', 'john.doe@example.com'),
('user2', 'Jane Smith', 'jane.smith@example.com'),
('user3', 'Bob Johnson', 'bob.johnson@example.com')
ON CONFLICT (user_id) DO NOTHING;

-- Insert sample transactions
INSERT INTO transactions (transaction_id, pet_id, user_id, status, adoption_date) VALUES 
('txn1', 'pet1', 'user1', 'completed', '2024-01-15 10:30:00'),
('txn2', 'pet2', 'user2', 'completed', '2024-01-16 14:20:00'),
('txn3', 'pet3', 'user3', 'completed', '2024-01-17 09:15:00')
ON CONFLICT (transaction_id) DO NOTHING;
