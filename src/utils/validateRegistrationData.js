exports.validateRegistrationData = (data) => {
  const { email, password, name, phone } = data;

  // 1. Required Fields Check
  if (!name) return 'Full Name is required';
  if (!email) return 'Email is required';
  if (!password) return 'Password is required';

  // 2. Email Format Check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Please enter a valid email address';
  }

  // 3. Password Strength Check
  if (password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }

  // 4. Phone Format Check (If provided, must be 11 digits)
  if (phone) {
    const phoneRegex = /^\d{11}$/;
    if (!phoneRegex.test(phone)) {
      return 'Phone number must be exactly 11 digits';
    }
  }

  return null; // All checks passed
};