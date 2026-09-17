import {
    getClientConfig,
    fetchPaymentMethods,
    makePayment,
    makeDetails,
    updateStateContainer,
    updatePaymentsLog,
    generateReference,
    generateReturnUrl,
    handleTestCardCopying
} from "../util.js";

// Enable test card copying
handleTestCardCopying();

// Function to get URL query parameters
const getQueryParam = (param) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
};

// Function to initialize the PayPal Component
document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM fully loaded and parsed.");

    const referenceField = document.getElementById("reference");
    const returnUrlField = document.getElementById("returnUrl");

    if (referenceField && returnUrlField) {
        const reference = generateReference();
        referenceField.value = reference;
        returnUrlField.value = generateReturnUrl(reference);
    }

    const startPaymentButton = document.getElementById("start-payment");
    if (!startPaymentButton) {
        console.error("Start payment button not found!");
        return;
    }

    startPaymentButton.addEventListener("click", async () => {
        console.log("Here we go! button clicked.");

        document.querySelector(".input-container").style.display = "none";
        startPaymentButton.style.display = "none";

        const countryCode = document.getElementById("countryCode")?.value || "US";
        const telephoneNumber = document.getElementById("telephoneNumber")?.value || "+447755564318";
        const currency = document.getElementById("currency")?.value || "USD";
        const value = parseInt(document.getElementById("amount")?.value || "2000", 10);
        const reference = document.getElementById("reference")?.value;
        const returnUrl = document.getElementById("returnUrl")?.value || generateReturnUrl(reference);
        const nativeThreeDS = document.getElementById("nativeThreeDS")?.checked ? "preferred" : undefined;
        const origin = window.location.origin;
        const shopperReference = document.getElementById("shopperReference")?.value || "guest";
        const shopperEmail = document.getElementById("shopperEmail")?.value || "customer@email.uk";
        const recurringProcessingModel = document.getElementById("recurringProcessingModel")?.value || "CardOnFile";
        const challengeWindowSize = document.getElementById("challengeWindowSize")?.value || "02";

        if (isNaN(value) || value < 0) {
            console.error("Invalid amount value. Please enter a valid number.");
            return;
        }

        const pmReqConfig = {
            countryCode,
            amount: { currency, value },
            shopperEmail,
            shopperReference
        };

        console.log("Payment request configuration:", pmReqConfig);

        try {
            const config = await getClientConfig();
            if (!config) throw new Error("Failed to load client config");

            const paymentMethodsResponse = await fetchPaymentMethods(pmReqConfig);
            if (!paymentMethodsResponse) throw new Error("Failed to load payment methods");

            if (!Array.isArray(paymentMethodsResponse.paymentMethods)) {
                console.error("Error: paymentMethodsResponse.paymentMethods is not an array", paymentMethodsResponse.paymentMethods);
            } else {
                console.log("paymentMethodsResponse.paymentMethods:", paymentMethodsResponse.paymentMethods);
            }
            
            // PayPal configuration
            const paypalConfiguration = {
                style: { // Optional configuration for PayPal payment buttons.
                    layout: "vertical",
                    color: "blue"
                },
                //cspNonce: "MY_CSP_NONCE",
                //onShippingChange: function(data, actions) {
                //    // Listen to shipping changes.
                //},
                onInit: (data, actions) => {
                    // onInit is called when the button first renders.
                    // Call actions.enable() to enable the button.
                    actions.enable();
                    // Or actions.disable() to disable it.
                },
                //onClick: () => {
                //    // onClick is called when the button is clicked.
                //},
                blockPayPalCreditButton: true,
                blockPayPalPayLaterButton: true
            };

            const configObj = {
                paymentMethodsResponse,
                clientKey: config.clientKey,
                locale: "en-US",
                environment: config.environment,
                countryCode,
                shopperLocale:"en_US",
                onChange: updateStateContainer,
                onSubmit: async (state, component, actions) => {
                    console.log('### paypal::onSubmit:: calling');

                    try {
                        document.getElementById("state-container").style.display = "none";

                        const paymentsReqData = {
                            ...state.data,
                            reference,
                            amount: { currency, value },
                            countryCode,
                            telephoneNumber,
                            shopperReference,
                            shopperEmail,
                            returnUrl,
                            origin,
                            channel: "Web",
                            recurringProcessingModel,
                            billingAddress: {
                                city: "London",
                                country: "GB",
                                houseNumberOrName: "Apt. 214",
                                postalCode: "W1S 3BE",
                                street: "10 New Burlington Street"
                            },
                            deliveryAddress: {
                                city: "London",
                                country: "GB",
                                houseNumberOrName: "Apt. 214",
                                postalCode: "W1S 3BE",
                                street: "10 New Burlington Street"
                            },
                            lineItems: [
                                    {
                                        quantity: "1",
                                        description: "Shoes",
                                        id: "Item #1",
                                        amountIncludingTax: "2000"
                                    }
                                ]
                        };

                        updatePaymentsLog("Payment Request", paymentsReqData);
                        const result = await makePayment(paymentsReqData);
                        updatePaymentsLog("Payment Response", result );

                        if (!result.resultCode) {
                            console.error("Payment failed, missing resultCode.");
                            actions.reject();
                            return;
                        }

                        const {
                            resultCode,
                            action,
                            order,
                            donationToken
                        } = result;

                        actions.resolve({
                            resultCode,
                            action,
                            order,
                            donationToken,
                        });

                    } catch (error) {
                        console.error("Payment error:", error);
                        actions.reject();
                    }
                },
                onAdditionalDetails: async (state, component, actions) => {
                    console.log("### paypal::onAdditionalDetails:: calling");

                    try {
                        updatePaymentsLog("Details Request", state.data);
                        const result = await makeDetails(state.data);
                        updatePaymentsLog("Details Response", result);

                        if (!result.resultCode) {
                            console.error("Additional details processing failed: Missing resultCode.");
                            actions.reject();
                            return;
                        }

                        const { resultCode, action } = result;

                        console.log("Handling additional details:", { resultCode, action });
                        actions.resolve({ resultCode });
                        //actions.resolve({ resultCode, action });
                    } catch (error) {
                        console.error("Additional details processing error:", error);
                        actions.reject();
                    }
                },
                onPaymentCompleted: async (result, component) => {

                    console.log("### paypal::onPaymentCompleted:: calling");
                    console.log(result);

                    const paypalContainer = document.getElementById("paypal-container");
                    if (!paypalContainer) {
                        console.error("PayPal container not found in the DOM.");
                        return;
                    }

                    paypalContainer.innerHTML = `
                        <h2>Payment Result</h2>
                        <p><strong>Status:</strong> ${result.resultCode}</p>
                    `;

                }
            };

            const { AdyenCheckout, PayPal } = window.AdyenWeb;
            const checkout = await AdyenCheckout(configObj);
            const paypal = new PayPal(checkout,paypalConfiguration).mount("#paypal-container");

        } catch (error) {
            console.error("Error during initialization:", error);
        }
    });
});

