import React from "react";
import { CalendarCheck, PhoneCall, Rocket } from "lucide-react";
import FormPage from "../components/ui/FormPage";
import StudentDemoForm from "../components/forms/StudentDemoForm";

const STEPS = [
  { Icon: PhoneCall, title: "We call you", text: "Our academic counsellor reaches out within one working day to understand the student's needs." },
  { Icon: CalendarCheck, title: "Free demo class", text: "Meet a matched expert tutor in a live one-on-one session at a time that suits you." },
  { Icon: Rocket, title: "Start learning", text: "Happy with the demo? Get a personalized learning plan and begin regular classes." },
];

const BookDemo = () => (
  <FormPage
    image="https://images.unsplash.com/photo-1758876020337-2501eeb1ede5?auto=format&fit=crop&w=1920&q=70"
    imagePosition="40% 30%"
    eyebrow="Free demo class"
    title="Start learning with the"
    highlight="right tutor."
    subtitle="Book a free, no-obligation demo class and experience personalized one-on-one tutoring from home."
    points={[
      "One-on-one session with an expert tutor",
      "Personalized learning plan for the student",
      "All major boards – CBSE, ICSE, IGCSE, IB & more",
      "Flexible timings that suit your schedule",
    ]}
    formTitle="Book your free demo"
    formSubtitle="Takes less than a minute. No payment needed."
    stepsTitle="From booking to learning in three easy steps"
    steps={STEPS}
  >
    <StudentDemoForm />
  </FormPage>
);

export default BookDemo;
