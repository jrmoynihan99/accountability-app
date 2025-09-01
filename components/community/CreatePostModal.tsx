import { BaseModal } from "@/components/morphing/BaseModal";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useTheme } from "@/hooks/ThemeContext";
import { useCreatePost } from "@/hooks/useCreatePost";
import { auth, db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { CreatePostConfirmationScreen } from "./CreatePostConfirmationScreen";
import { CreatePostInputScreen } from "./CreatePostInputScreen";
import { CreatePostPendingScreen } from "./CreatePostPendingScreen";
import { CreatePostRejectedScreen } from "./CreatePostRejectedScreen";

export type PostCategory = "testimonies" | "resources" | "questions" | "other";

type ScreenType = "input" | "pending" | "confirmation" | "rejected";

interface CreatePostModalProps {
  isVisible: boolean;
  progress: Animated.SharedValue<number>;
  modalAnimatedStyle: any;
  close: (velocity?: number) => void;
}

export function CreatePostModal({
  isVisible,
  progress,
  modalAnimatedStyle,
  close,
}: CreatePostModalProps) {
  const { colors, effectiveTheme } = useTheme();
  const { createPost, creating, error } = useCreatePost();

  // Screen logic
  const [currentScreen, setCurrentScreen] = useState<ScreenType>("input");
  const [currentPostId, setCurrentPostId] = useState<string | null>(null);
  const screenTransition = useSharedValue(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<PostCategory[]>(
    []
  );

  // Reset state when closed
  useEffect(() => {
    if (!isVisible) {
      const timer = setTimeout(() => {
        setCurrentScreen("input");
        setCurrentPostId(null);
        screenTransition.value = 0;
        setTitle("");
        setContent("");
        setSelectedCategories([]);
        // Clean up any existing listener
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  // Clean up listener on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const transitionToScreen = (screen: ScreenType) => {
    if (screen === "input") {
      // Going back to input
      screenTransition.value = withTiming(0, {
        duration: 300,
        easing: Easing.out(Easing.quad),
      });
      setCurrentScreen(screen);
    } else if (currentScreen === "input") {
      // Going from input to any other screen
      setCurrentScreen(screen);
      screenTransition.value = withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.quad),
      });
    } else {
      // Going between non-input screens - change screen first, then animate
      setCurrentScreen(screen);
      screenTransition.value = 0;
      // Use a small delay to ensure the screen change renders before animation
      setTimeout(() => {
        screenTransition.value = withTiming(1, {
          duration: 300,
          easing: Easing.out(Easing.quad),
        });
      }, 16); // One frame delay
    }
  };

  // Submit handler
  const handleSubmit = async () => {
    if (creating) return;

    const user = auth.currentUser;
    if (!user) {
      console.error("No user logged in");
      return;
    }

    try {
      // First transition to pending screen
      transitionToScreen("pending");

      // Create the post - assuming createPost returns the created document ID
      const postId = await createPost({
        title,
        content,
        categories: selectedCategories,
      });

      if (postId) {
        setCurrentPostId(postId);

        // Set up real-time listener for status changes
        const unsubscribe = onSnapshot(
          doc(db, "communityPosts", postId),
          (doc) => {
            if (doc.exists()) {
              const data = doc.data();
              const status = data.status;

              console.log(`Post ${postId} status updated to: ${status}`);

              if (status === "approved") {
                transitionToScreen("confirmation");
                // Auto-close after 3 seconds
                setTimeout(() => {
                  close?.();
                }, 3000);
              } else if (status === "rejected") {
                transitionToScreen("rejected");
              }
              // If still "pending", stay on pending screen
            }
          }
        );

        // Store the unsubscribe function
        unsubscribeRef.current = unsubscribe;
      }
    } catch (error) {
      console.error("Error creating post:", error);
      // On error, go back to input screen
      transitionToScreen("input");
    }
  };

  const handleRetry = () => {
    // Clean up current listener
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setCurrentPostId(null);
    screenTransition.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.quad),
    });
    setCurrentScreen("input");
  };

  // Confirm before discarding post if input has content
  const handleClose = () => {
    if (currentScreen === "input" && (title.trim() || content.trim())) {
      Alert.alert(
        "Discard Post?",
        "Are you sure you want to discard this post?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              setTitle("");
              setContent("");
              setSelectedCategories([]);
              close();
            },
          },
        ]
      );
    } else {
      close();
    }
  };

  // Animation styles
  const inputScreenStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          screenTransition.value,
          [0, 1],
          [0, -100],
          "clamp"
        ),
      },
    ],
    opacity: interpolate(
      screenTransition.value,
      [0, 0.8, 1],
      [1, 0.3, 0],
      "clamp"
    ),
  }));

  const activeScreenStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          screenTransition.value,
          [0, 1],
          [300, 0],
          "clamp"
        ),
      },
    ],
    opacity: interpolate(
      screenTransition.value,
      [0, 0.2, 1],
      [0, 1, 1],
      "clamp"
    ),
  }));

  // Render the appropriate screen based on currentScreen state
  const renderActiveScreen = () => {
    switch (currentScreen) {
      case "pending":
        return <CreatePostPendingScreen />;
      case "confirmation":
        return <CreatePostConfirmationScreen />;
      case "rejected":
        return (
          <CreatePostRejectedScreen
            onClose={close}
            onRetry={handleRetry}
            originalTitle={title}
            originalContent={content}
          />
        );
      default:
        return null;
    }
  };

  // FAB content (plus icon)
  const buttonContent = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <IconSymbol name="plus" size={28} color={colors.white} />
    </View>
  );

  // Modal content with all screens
  const modalContent = (
    <View style={{ flex: 1, minHeight: 420, position: "relative" }}>
      {/* Input Screen - Always rendered */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          },
          inputScreenStyle,
        ]}
      >
        <CreatePostInputScreen
          title={title}
          setTitle={setTitle}
          content={content}
          setContent={setContent}
          selectedCategories={selectedCategories}
          setSelectedCategories={setSelectedCategories}
          creating={creating}
          error={error}
          onSubmit={handleSubmit}
        />
      </Animated.View>

      {/* Active Screen - Conditionally rendered based on currentScreen */}
      {currentScreen !== "input" && (
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            },
            activeScreenStyle,
          ]}
        >
          {renderActiveScreen()}
        </Animated.View>
      )}
    </View>
  );

  return (
    <BaseModal
      isVisible={isVisible}
      progress={progress}
      modalAnimatedStyle={modalAnimatedStyle}
      close={handleClose}
      theme={effectiveTheme ?? "dark"}
      backgroundColor={colors.cardBackground}
      buttonBackgroundColor={colors.buttonBackground}
      buttonContent={buttonContent}
      buttonContentOpacityRange={[0, 0.15]}
      buttonContentPadding={0}
      buttonBorderRadius={28}
    >
      {modalContent}
    </BaseModal>
  );
}
