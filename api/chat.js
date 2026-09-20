const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  // Allow browser requests from thattalkingguy.com
  res.setHeader("Access-Control-Allow-Origin", "https://thattalkingguy.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method Not Allowed",
    });
  }

  try {
    const {
      question,
      conversation = [],
      visitor = {},
    } = req.body || {};

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        success: false,
        error: "Question is required.",
      });
    }

    // Load Gemini without exposing the API key to the browser.
    const { GoogleGenAI } = await import("@google/genai");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const systemInstruction = `
You are Sharon, the AI client assistant for ThattalkingGuy...

Your job is to help website visitors understand the services offered by
ThattalkingGuy... and identify genuine business opportunities.

Available services:
1. AI-Powered Websites
2. Ecommerce Systems
3. Multi-Vendor Marketplaces
4. Digital Product Platforms
5. Business Automation
6. Custom Web Applications
7. Digital Business Consulting

Your personality:
- Friendly
- Professional
- Helpful
- Concise
- Natural
- Never pushy

Important:
- You are Sharon, the AI client assistant.
- Do not pretend to be the owner of ThattalkingGuy...
- If a visitor specifically wants to speak with the owner, collect their
  contact information and explain that you can flag the request for attention.
- Do not promise prices, delivery dates, features, or results that have not
  been confirmed.
- Do not make financial guarantees.
- Help visitors describe what they want to build.

Your response must be valid JSON with exactly these fields:

{
  "answer": "Your natural response to the visitor",
  "intent": "general|potential_client|existing_client|pending_job|owner_attention",
  "needs_attention": true,
  "lead": {
    "name": "",
    "email": "",
    "phone": "",
    "service": "",
    "budget": "",
    "timeline": "",
    "project": ""
  }
}

Set needs_attention to true when:
- The visitor appears ready to hire ThattalkingGuy...
- The visitor wants a quote or proposal
- The visitor wants to start a project
- The visitor reports an existing client/job issue
- The visitor asks to speak directly with the owner
- The visitor provides meaningful project information that deserves follow-up

Set needs_attention to false for ordinary questions or casual conversation.

Never invent visitor information.
`;

    const historyText = Array.isArray(conversation)
      ? conversation
          .slice(-12)
          .map((item) => {
            const role = item.role || "user";
            const content = item.content || "";
            return `${role}: ${content}`;
          })
          .join("\n")
      : "";

    const visitorText = `
Known visitor information:
Name: ${visitor.name || "Not provided"}
Email: ${visitor.email || "Not provided"}
Phone: ${visitor.phone || "Not provided"}

Recent conversation:
${historyText}

New visitor message:
${question}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      },
      contents: visitorText,
    });

    let result;

    try {
      result = JSON.parse(response.text);
    } catch {
      result = {
        answer: response.text,
        intent: "general",
        needs_attention: false,
        lead: {
          name: visitor.name || "",
          email: visitor.email || "",
          phone: visitor.phone || "",
          service: "",
          budget: "",
          timeline: "",
          project: "",
        },
      };
    }

    const lead = result.lead || {};

    // Preserve information supplied directly by the visitor.
    lead.name = lead.name || visitor.name || "";
    lead.email = lead.email || visitor.email || "";
    lead.phone = lead.phone || visitor.phone || "";

    result.lead = lead;

    /*
     * Email notification:
     *
     * We only alert the owner when Sharon determines that the conversation
     * requires attention. This prevents ordinary chat messages from
     * generating unnecessary emails.
     */
    if (result.needs_attention === true) {
      const ownerEmail =
        process.env.OWNER_EMAIL || "hello@thattalkingguy.com";

      const fromEmail =
        process.env.FROM_EMAIL || "Sharon <onboarding@resend.dev>";

      const subject =
        result.intent === "pending_job"
          ? "🔔 Sharon: Pending Job Needs Attention"
          : result.intent === "existing_client"
          ? "🔔 Sharon: Existing Client Needs Attention"
          : "🔥 Sharon: New ThattalkingGuy... Lead";

      const emailHtml = `
        <div style="font-family:Arial,sans-serif;line-height:1.6">
          <h2>${subject}</h2>

          <p><strong>Sharon's assessment:</strong></p>
          <p>${escapeHtml(result.answer || "")}</p>

          <hr>

          <h3>Lead / Client Information</h3>

          <p><strong>Name:</strong> ${escapeHtml(lead.name || "Not provided")}</p>
          <p><strong>Email:</strong> ${escapeHtml(lead.email || "Not provided")}</p>
          <p><strong>Phone:</strong> ${escapeHtml(lead.phone || "Not provided")}</p>
          <p><strong>Service:</strong> ${escapeHtml(lead.service || "Not identified")}</p>
          <p><strong>Budget:</strong> ${escapeHtml(lead.budget || "Not provided")}</p>
          <p><strong>Timeline:</strong> ${escapeHtml(lead.timeline || "Not provided")}</p>
          <p><strong>Project:</strong> ${escapeHtml(lead.project || "Not provided")}</p>

          <hr>

          <p>
            <strong>Intent:</strong>
            ${escapeHtml(result.intent || "unknown")}
          </p>

          <p>
            This notification was generated by Sharon,
            the AI client assistant for ThattalkingGuy...
          </p>
        </div>
      `;

      try {
        await resend.emails.send({
          from: fromEmail,
          to: ownerEmail,
          subject,
          html: emailHtml,
        });
      } catch (emailError) {
        console.error("Sharon email notification error:", emailError);
      }
    }

    return res.status(200).json({
      success: true,
      answer: result.answer || "How can I help you?",
      intent: result.intent || "general",
      needs_attention: Boolean(result.needs_attention),
      lead: result.lead,
    });
  } catch (error) {
    console.error("Sharon Error:", error);

    return res.status(500).json({
      success: false,
      error: "Sharon is temporarily unavailable. Please try again.",
    });
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}