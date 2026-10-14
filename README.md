# Tutorial Center

Production deployment requirements are documented in [HOSTING.md](HOSTING.md).

This is a web application for managing a tutorial center. It allows administrators to manage students, enrollments, billing, and payments.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   XAMPP (or any other web server with PHP and MySQL)
*   Node.js and npm

### Installation

1.  **Clone the repository:**

    ```
    git clone https://github.com/your-username/tutorial_center.git
    ```

2.  **Import the database:**

    *   Create a new database in phpMyAdmin.
    *   Import the `discount.sql` and `enrollment_details.sql` files into the new database.

3.  **Configure the database connection:**

    * Copy `api/config/runtime.local.php.example` to
      `api/config/runtime.local.php`.
    * Update the `DB_*` values for your MySQL/MariaDB database. Environment
      variables with the same names can be used instead.

4.  **Install the dependencies:**

    ```
    npm install
    ```

5.  **Run the application:**

    *   Start your XAMPP server.
    *   Open your web browser and navigate to `http://localhost/tutorial_center`.
"# cdotcl" 
