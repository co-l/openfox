const notificationSound = new Audio('/sounds/notification.mp3')
notificationSound.volume = 0.5

export const playNotification = () => {
  notificationSound.currentTime = 0
  notificationSound.play().catch(() => {}) // Ignore autoplay errors
}
