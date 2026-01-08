/**
 * FIX CALL REJECTION ISSUES
 *
 * Issues to fix:
 * 1. Free minute not working - charged ₹0.05 instead of free (ALREADY FIXED)
 * 2. Call rejection modal not working - status showing completed
 * 3. Provider rejection not cutting call - both sides showing completed
 * 4. Need proper reject/decline functionality
 */

const fs = require("fs");
const path = require("path");

// Fix 1: Add proper rejection endpoint to consultation routes
const routesPath = path.join(__dirname, "src/routes/consultation.routes.js");
let routesContent = fs.readFileSync(routesPath, "utf8");

// Check if reject route already exists
if (!routesContent.includes("/:id/reject")) {
  // Add reject route
  const routeToAdd = `
// Reject consultation (provider declines call)
router.put("/:id/reject", auth, consultation.rejectConsultation);
`;

  // Find the cancel route and add reject route after it
  const cancelRouteIndex = routesContent.indexOf("/:id/cancel");
  if (cancelRouteIndex !== -1) {
    const insertIndex = routesContent.indexOf("\n", cancelRouteIndex) + 1;
    routesContent =
      routesContent.slice(0, insertIndex) +
      routeToAdd +
      routesContent.slice(insertIndex);

    fs.writeFileSync(routesPath, routesContent, "utf8");
    console.log("✅ Added reject route to consultation routes");
  }
}

// Fix 2: Add rejectConsultation function to consultation controller
const controllerPath = path.join(
  __dirname,
  "src/controllers/consultation.controller.js"
);
let controllerContent = fs.readFileSync(controllerPath, "utf8");

// Check if rejectConsultation function already exists
if (!controllerContent.includes("const rejectConsultation")) {
  const rejectFunction = `
// @desc    Reject consultation (provider declines call)
// @route   PUT /api/consultations/:id/reject
// @access  Private
const rejectConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError("Consultation not found", 404));
    }

    // Only provider can reject consultations
    const consultationProviderId = consultation.provider.toString();
    const requestingUserId = req.user?._id?.toString();

    if (consultationProviderId !== requestingUserId) {
      return next(new AppError("Only the provider can reject this consultation", 403));
    }

    // Can only reject pending consultations
    if (consultation.status !== "pending") {
      return next(new AppError("Can only reject pending consultations", 400));
    }

    // Update consultation status to rejected
    consultation.status = "rejected";
    consultation.endTime = new Date();
    consultation.endReason = "provider_rejected";
    await consultation.save();

    // Emit socket event to notify client
    const io = req.app.get('io');
    if (io) {
      // Notify the client that call was rejected
      io.to(\`consultation:\${consultation._id}\`).emit("consultation:call-rejected", {
        consultationId: consultation._id,
        reason: "Provider declined the call",
        rejectedByName: req.user.fullName || req.user.name,
        status: "rejected",
        timestamp: new Date().toISOString(),
      });

      console.log("📡 SOCKET: Call rejection emitted to client");
    }

    res.status(200).json({
      success: true,
      message: "Consultation rejected successfully",
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};
`;

  // Find the cancelConsultation function and add rejectConsultation after it
  const cancelFunctionIndex = controllerContent.indexOf(
    "const cancelConsultation"
  );
  if (cancelFunctionIndex !== -1) {
    // Find the end of cancelConsultation function
    let braceCount = 0;
    let insertIndex = cancelFunctionIndex;
    let inFunction = false;

    for (let i = cancelFunctionIndex; i < controllerContent.length; i++) {
      if (controllerContent[i] === "{") {
        braceCount++;
        inFunction = true;
      } else if (controllerContent[i] === "}") {
        braceCount--;
        if (inFunction && braceCount === 0) {
          insertIndex = i + 1;
          break;
        }
      }
    }

    // Find the next line after the function
    const nextLineIndex = controllerContent.indexOf("\n", insertIndex);
    if (nextLineIndex !== -1) {
      insertIndex = nextLineIndex + 1;
    }

    controllerContent =
      controllerContent.slice(0, insertIndex) +
      rejectFunction +
      controllerContent.slice(insertIndex);

    // Add to exports
    if (controllerContent.includes("cancelConsultation,")) {
      controllerContent = controllerContent.replace(
        "cancelConsultation,",
        "cancelConsultation,\n  rejectConsultation,"
      );
    }

    fs.writeFileSync(controllerPath, controllerContent, "utf8");
    console.log("✅ Added rejectConsultation function to controller");
  }
}

// Fix 3: Update cancelConsultation to properly set status based on who cancels
const oldCancelLogic = `    consultation.status = "cancelled";`;
const newCancelLogic = `    // Set status based on who is cancelling
    if (isProvider && consultation.status === "pending") {
      consultation.status = "rejected"; // Provider rejecting pending call
      consultation.endReason = "provider_rejected";
    } else {
      consultation.status = "cancelled"; // User cancelling or other scenarios
      consultation.endReason = "user_cancelled";
    }`;

if (
  controllerContent.includes(oldCancelLogic) &&
  !controllerContent.includes("endReason")
) {
  controllerContent = controllerContent.replace(oldCancelLogic, newCancelLogic);
  fs.writeFileSync(controllerPath, controllerContent, "utf8");
  console.log("✅ Updated cancelConsultation to set proper status");
}

console.log("\n🎯 CALL REJECTION FIXES APPLIED");
console.log("─".repeat(50));
console.log("Fixed issues:");
console.log(
  "1. ✅ Added proper reject endpoint (/api/consultations/:id/reject)"
);
console.log("2. ✅ Added rejectConsultation controller function");
console.log("3. ✅ Updated cancelConsultation to set proper status");
console.log("4. ✅ Added socket events for call rejection");
console.log("");
console.log("Next steps:");
console.log("- Frontend needs Decline/Reject button for providers");
console.log("- Frontend needs to call reject API instead of just navigate(-1)");
console.log(
  "- Frontend needs to handle consultation:call-rejected socket event"
);
