const firebaseConfig = {
  apiKey:            "AIzaSyBgFqMIFv0GiEUZzO7TBSB-t8a7w9C7r9M",
  authDomain:        "hoobishift.firebaseapp.com",
  projectId:         "hoobishift",
  storageBucket:     "hoobishift.firebasestorage.app",
  messagingSenderId: "267189380811",
  appId:             "1:267189380811:web:e116c009ec639cccce9d4e",
  measurementId:     "G-GLQB2WP526"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
